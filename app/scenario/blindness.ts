// An end-to-end seed scenario for operator-blindness and selective disclosure,
// driven through the ledger client. It doubles as the demo's cold-load seed: it
// leaves a small persistent book so every party role has something real to show.
//
// It allocates parties and writes two encrypted bilateral trades: A–B (disclosed to
// Alice's home regulator) and B–C (disclosed to no one). It then reads each party's
// own projection. What it proves on a real ledger:
//   - the counterparties see and can decrypt their own trades;
//   - the operator's projection contains no trade at all — a stakeholder of nothing;
//   - Alice's regulator sees and can decrypt exactly the A–B trade, and NOT the B–C
//     trade Bob also holds — a measured no against a real existing trade, so the
//     scoping is honest (R6), not vacuous.
// This is the privacy claim (R5.4/R6), enforced by Canton's projection rather than
// by any filtering in the client.
import { generateKeyPair, sealLeg, openLeg, type JsonValue, type KeyPair } from "../crypto/index";
import { LedgerClient, createCommand } from "../ledger/index";
import { TEMPLATES, createBilateralTrade, createSelectiveAuditDisclosure, decodeBilateralTrade } from "../model/index";

export interface BlindnessResult {
  readonly operatorTradeCount: number;
  readonly aliceTradeCount: number;
  readonly bobTradeCount: number; // 2: A–B and B–C
  readonly carolTradeCount: number; // 1: B–C
  readonly regulatorTradeCount: number; // 1: A–B only
  readonly aliceDecryptedTerms: JsonValue;
  readonly onLedgerTermsAreCiphertext: boolean;
  // Whether Alice's home regulator can see and decrypt exactly her disclosed A–B trade.
  readonly regulatorSeesAliceTrade: boolean;
  // Must be false: the regulator is scoped to A–B and cannot see Bob's separate B–C trade.
  readonly regulatorSeesBobCarolTrade: boolean;
  readonly parties: {
    readonly operator: string;
    readonly alice: string;
    readonly bob: string;
    readonly carol: string;
    readonly regulator: string;
  };
}

const TRADE_TEMPLATE = [TEMPLATES.BilateralTrade];

export async function runOperatorBlindnessScenario(client: LedgerClient): Promise<BlindnessResult> {
  const run = Math.random().toString(36).slice(2, 8);
  const operator = await client.allocateParty(`Operator-${run}`);
  const alice = await client.allocateParty(`Alice-${run}`);
  const bob = await client.allocateParty(`Bob-${run}`);
  const carol = await client.allocateParty(`Carol-${run}`);
  const regulator = await client.allocateParty(`RegulatorA-${run}`);

  const aliceKeys: KeyPair = await generateKeyPair();
  const bobKeys: KeyPair = await generateKeyPair();
  const carolKeys: KeyPair = await generateKeyPair();
  const regulatorKeys: KeyPair = await generateKeyPair();

  // A–B: the content key is wrapped to Alice, Bob, and Alice's regulator only —
  // never to the operator. Alice discloses this one trade to her regulator.
  const abTerms: JsonValue = { instrument: "IRS", notional: 100_000_000, fixedRate: 0.0325, currency: "USD" };
  const ab = await sealLeg(abTerms, [
    { party: alice, publicKey: aliceKeys.publicKey },
    { party: bob, publicKey: bobKeys.publicKey },
    { party: regulator, publicKey: regulatorKeys.publicKey },
  ]);
  await client.submitAndWait([alice, bob], [
    createCommand(
      TEMPLATES.BilateralTrade,
      createBilateralTrade({ cptyA: alice, cptyB: bob, tradeRef: "AB", terms: ab.ciphertext, commitment: ab.commitment, auditors: [regulator] }),
    ),
  ]);

  // B–C: a separate trade Bob holds with Carol, disclosed to no one — the regulator
  // must not see it. The content key is wrapped to Bob and Carol only.
  const bcTerms: JsonValue = { instrument: "IRS", notional: 60_000_000, fixedRate: 0.0288, currency: "USD" };
  const bc = await sealLeg(bcTerms, [
    { party: bob, publicKey: bobKeys.publicKey },
    { party: carol, publicKey: carolKeys.publicKey },
  ]);
  await client.submitAndWait([bob, carol], [
    createCommand(
      TEMPLATES.BilateralTrade,
      createBilateralTrade({ cptyA: bob, cptyB: carol, tradeRef: "BC", terms: bc.ciphertext, commitment: bc.commitment, auditors: [] }),
    ),
  ]);

  // Alice records the scoped disclosure grant — the on-ledger record of the
  // decryption scope she shared with her regulator, for the A–B trade only.
  await client.submitAndWait([alice], [
    createCommand(
      TEMPLATES.SelectiveAuditDisclosure,
      createSelectiveAuditDisclosure({ participant: alice, auditor: regulator, encDecryptionScope: ab.wrappedKeys[regulator] ?? "" }),
    ),
  ]);

  const [operatorAcs, aliceAcs, bobAcs, carolAcs, regulatorAcs] = await Promise.all([
    client.activeContracts(operator, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(alice, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(bob, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(carol, { templateIds: TRADE_TEMPLATE }),
    client.activeContracts(regulator, { templateIds: TRADE_TEMPLATE }),
  ]);

  const aliceTrade = decodeBilateralTrade(aliceAcs.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === "AB")!.createArgument);
  const onLedgerTermsAreCiphertext = aliceTrade.terms === ab.ciphertext && aliceTrade.terms !== JSON.stringify(abTerms);
  const aliceDecryptedTerms = await openLeg(
    { ciphertext: aliceTrade.terms, commitment: aliceTrade.commitment, wrappedKeys: ab.wrappedKeys },
    alice,
    aliceKeys,
  );

  // The regulator sees and can decrypt exactly the A–B trade from its own projection.
  let regulatorSeesAliceTrade = false;
  const regAB = regulatorAcs.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === "AB");
  if (regAB) {
    const decoded = decodeBilateralTrade(regAB.createArgument);
    const opened = (await openLeg(
      { ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: ab.wrappedKeys },
      regulator,
      regulatorKeys,
    )) as Record<string, unknown>;
    regulatorSeesAliceTrade = opened["instrument"] === "IRS";
  }
  // The regulator must NOT see Bob's separate B–C trade — a measured no.
  const regulatorSeesBobCarolTrade = regulatorAcs.some((c) => decodeBilateralTrade(c.createArgument).tradeRef === "BC");

  return {
    operatorTradeCount: operatorAcs.length,
    aliceTradeCount: aliceAcs.length,
    bobTradeCount: bobAcs.length,
    carolTradeCount: carolAcs.length,
    regulatorTradeCount: regulatorAcs.length,
    aliceDecryptedTerms,
    onLedgerTermsAreCiphertext,
    regulatorSeesAliceTrade,
    regulatorSeesBobCarolTrade,
    parties: { operator, alice, bob, carol, regulator },
  };
}
