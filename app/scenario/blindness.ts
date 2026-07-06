// An end-to-end operator-blindness and selective-disclosure scenario, driven
// through the ledger client.
//
// It allocates parties, writes an encrypted bilateral trade signed by its two
// counterparties, then reads each party's own projection. The point it proves on a
// real ledger: the two counterparties see the trade (and can decrypt it), while the
// operator's projection contains no trade at all — the operator is a stakeholder of
// nothing, and what is on-ledger is ciphertext. This is the privacy claim (R5.4),
// enforced by Canton's projection rather than by any filtering in the client.
//
// Alice additionally discloses this one trade to her home regulator: the content
// key is sealed to the regulator as a third recipient, the regulator is named as a
// scoped observer on that contract, and Alice records the disclosure grant. The
// regulator's own projection then contains exactly Alice's trade — nothing of any
// other participant — giving the demo's regulator role a real, scoped view (R6).
import { generateKeyPair, sealLeg, openLeg, type JsonValue } from "../crypto/index";
import { LedgerClient, createCommand } from "../ledger/index";
import { TEMPLATES, createBilateralTrade, createSelectiveAuditDisclosure, decodeBilateralTrade } from "../model/index";

export interface BlindnessResult {
  readonly operatorTradeCount: number;
  readonly aliceTradeCount: number;
  readonly bobTradeCount: number;
  readonly regulatorTradeCount: number;
  readonly aliceDecryptedTerms: JsonValue;
  readonly onLedgerTermsAreCiphertext: boolean;
  // Whether Alice's home regulator can see and decrypt exactly her disclosed trade.
  readonly regulatorSeesAliceTrade: boolean;
  readonly parties: { readonly operator: string; readonly alice: string; readonly bob: string; readonly regulator: string };
}

const TRADE_TEMPLATE = [TEMPLATES.BilateralTrade];

export async function runOperatorBlindnessScenario(client: LedgerClient): Promise<BlindnessResult> {
  const run = Math.random().toString(36).slice(2, 8);
  const operator = await client.allocateParty(`Operator-${run}`);
  const alice = await client.allocateParty(`Alice-${run}`);
  const bob = await client.allocateParty(`Bob-${run}`);
  const regulator = await client.allocateParty(`RegulatorA-${run}`);

  // Alice, Bob, and Alice's regulator hold X25519 keys; the trade's content key is
  // wrapped to those three only, never to the operator.
  const aliceKeys = await generateKeyPair();
  const bobKeys = await generateKeyPair();
  const regulatorKeys = await generateKeyPair();

  const terms: JsonValue = { instrument: "IRS", notional: 100_000_000, fixedRate: 0.0325, currency: "USD" };
  const sealed = await sealLeg(terms, [
    { party: alice, publicKey: aliceKeys.publicKey },
    { party: bob, publicKey: bobKeys.publicKey },
    { party: regulator, publicKey: regulatorKeys.publicKey },
  ]);

  // A single multi-party submission signed by both counterparties, naming Alice's
  // regulator as a scoped observer of this one trade. The operator is not a party to
  // the command and never becomes a stakeholder of the trade.
  await client.submitAndWait(
    [alice, bob],
    [
      createCommand(
        TEMPLATES.BilateralTrade,
        createBilateralTrade({
          cptyA: alice,
          cptyB: bob,
          tradeRef: "AB",
          terms: sealed.ciphertext,
          commitment: sealed.commitment,
          auditors: [regulator],
        }),
      ),
    ],
  );

  // Alice records the scoped disclosure grant itself — the on-ledger record of the
  // decryption scope she shared with her regulator for this trade only.
  await client.submitAndWait([alice], [
    createCommand(
      TEMPLATES.SelectiveAuditDisclosure,
      createSelectiveAuditDisclosure({
        participant: alice,
        auditor: regulator,
        encDecryptionScope: sealed.wrappedKeys[regulator] ?? "",
      }),
    ),
  ]);

  const [operatorAcs, aliceAcs, bobAcs, regulatorAcs] = await Promise.all([
    client.activeContracts(operator, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(alice, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(bob, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(regulator, { templateIds: TRADE_TEMPLATE }),
  ]);

  const aliceTrade = decodeBilateralTrade(aliceAcs[0]!.createArgument);
  const onLedgerTermsAreCiphertext = aliceTrade.terms === sealed.ciphertext && aliceTrade.terms !== JSON.stringify(terms);
  const aliceDecryptedTerms = await openLeg(
    { ciphertext: aliceTrade.terms, commitment: aliceTrade.commitment, wrappedKeys: sealed.wrappedKeys },
    alice,
    aliceKeys,
  );

  // The regulator sees Alice's trade in its own projection and can decrypt it with
  // its own key — a genuine scoped read, not a filtered view.
  let regulatorSeesAliceTrade = false;
  const regulatorTrade = regulatorAcs.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === "AB");
  if (regulatorTrade) {
    const decoded = decodeBilateralTrade(regulatorTrade.createArgument);
    const opened = (await openLeg(
      { ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: sealed.wrappedKeys },
      regulator,
      regulatorKeys,
    )) as Record<string, unknown>;
    regulatorSeesAliceTrade = opened["instrument"] === "IRS";
  }

  return {
    operatorTradeCount: operatorAcs.length,
    aliceTradeCount: aliceAcs.length,
    bobTradeCount: bobAcs.length,
    regulatorTradeCount: regulatorAcs.length,
    aliceDecryptedTerms,
    onLedgerTermsAreCiphertext,
    regulatorSeesAliceTrade,
    parties: { operator, alice, bob, regulator },
  };
}
