// An end-to-end operator-blindness scenario, driven through the ledger client.
//
// It allocates parties, writes an encrypted bilateral trade signed by its two
// counterparties, then reads each party's own projection. The point it proves on a
// real ledger: the two counterparties see the trade (and can decrypt it), while the
// operator's projection contains no trade at all — the operator is a stakeholder of
// nothing, and what is on-ledger is ciphertext. This is the privacy claim (R5.4),
// enforced by Canton's projection rather than by any filtering in the client.
import { generateKeyPair, sealLeg, openLeg, type JsonValue } from "../crypto/index";
import { LedgerClient, createCommand } from "../ledger/index";
import { TEMPLATES, createBilateralTrade, decodeBilateralTrade } from "../model/index";

export interface BlindnessResult {
  readonly operatorTradeCount: number;
  readonly aliceTradeCount: number;
  readonly bobTradeCount: number;
  readonly aliceDecryptedTerms: JsonValue;
  readonly onLedgerTermsAreCiphertext: boolean;
  readonly parties: { readonly operator: string; readonly alice: string; readonly bob: string };
}

const TRADE_TEMPLATE = [TEMPLATES.BilateralTrade];

export async function runOperatorBlindnessScenario(client: LedgerClient): Promise<BlindnessResult> {
  const run = Math.random().toString(36).slice(2, 8);
  const operator = await client.allocateParty(`Operator-${run}`);
  const alice = await client.allocateParty(`Alice-${run}`);
  const bob = await client.allocateParty(`Bob-${run}`);

  // Alice and Bob hold X25519 keys; the trade's content key is wrapped to them only,
  // never to the operator.
  const aliceKeys = await generateKeyPair();
  const bobKeys = await generateKeyPair();

  const terms: JsonValue = { instrument: "IRS", notional: 100_000_000, fixedRate: 0.0325, currency: "USD" };
  const sealed = await sealLeg(terms, [
    { party: alice, publicKey: aliceKeys.publicKey },
    { party: bob, publicKey: bobKeys.publicKey },
  ]);

  // A single multi-party submission signed by both counterparties. The operator is
  // not a party to the command and never becomes a stakeholder of the trade.
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
          auditors: [],
        }),
      ),
    ],
  );

  const [operatorAcs, aliceAcs, bobAcs] = await Promise.all([
    client.activeContracts(operator, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(alice, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(bob, { templateIds: TRADE_TEMPLATE }),
  ]);

  const aliceTrade = decodeBilateralTrade(aliceAcs[0]!.createArgument);
  const onLedgerTermsAreCiphertext = aliceTrade.terms === sealed.ciphertext && aliceTrade.terms !== JSON.stringify(terms);
  const aliceDecryptedTerms = await openLeg(
    { ciphertext: aliceTrade.terms, commitment: aliceTrade.commitment, wrappedKeys: sealed.wrappedKeys },
    alice,
    aliceKeys,
  );

  return {
    operatorTradeCount: operatorAcs.length,
    aliceTradeCount: aliceAcs.length,
    bobTradeCount: bobAcs.length,
    aliceDecryptedTerms,
    onLedgerTermsAreCiphertext,
    parties: { operator, alice, bob },
  };
}
