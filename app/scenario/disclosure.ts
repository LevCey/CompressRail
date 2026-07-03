// The selective regulator disclosure scenario (R6), driven live against Canton.
//
// Alice creates a bilateral trade naming her regulator as an observer, and seals the
// content key to the regulator as an additional recipient alongside her
// counterparty. She then grants a `SelectiveAuditDisclosure` recording the scope.
// The point this proves live: Regulator(A) sees and can decrypt exactly Alice's
// trade — nothing of Bob's, and nothing of any other participant's — with no
// transitive disclosure (R6.2).
import { generateKeyPair, sealLeg, openLeg, type KeyPair } from "../crypto/index";
import { LedgerClient, createCommand } from "../ledger/index";
import { TEMPLATES, createBilateralTrade, createSelectiveAuditDisclosure, decodeBilateralTrade } from "../model/index";

export interface DisclosureResult {
  readonly regulatorASeesOwnTrade: boolean;
  readonly regulatorADecryptedInstrument: string | null;
  readonly regulatorASeesBobsTrade: boolean;
  readonly regulatorBSeesAlicesTrade: boolean;
}

export async function runSelectiveDisclosureScenario(client: LedgerClient): Promise<DisclosureResult> {
  const run = Math.random().toString(36).slice(2, 8);
  const alice: { id: string; keys: KeyPair } = { id: await client.allocateParty(`Alice-${run}`), keys: await generateKeyPair() };
  const bob: { id: string; keys: KeyPair } = { id: await client.allocateParty(`Bob-${run}`), keys: await generateKeyPair() };
  const carol: { id: string; keys: KeyPair } = { id: await client.allocateParty(`Carol-${run}`), keys: await generateKeyPair() };
  const regulatorA: { id: string; keys: KeyPair } = { id: await client.allocateParty(`RegulatorA-${run}`), keys: await generateKeyPair() };
  const regulatorB: { id: string; keys: KeyPair } = { id: await client.allocateParty(`RegulatorB-${run}`), keys: await generateKeyPair() };

  // Alice's trade with Bob: sealed to Alice, Bob, and — because she is disclosing —
  // Regulator(A) as a third recipient. No other party is ever wrapped in.
  const aliceTerms = { instrument: "IRS", notional: 50_000_000, risk: { "2Y": 10 } };
  const aliceSealed = await sealLeg(aliceTerms, [
    { party: alice.id, publicKey: alice.keys.publicKey },
    { party: bob.id, publicKey: bob.keys.publicKey },
    { party: regulatorA.id, publicKey: regulatorA.keys.publicKey },
  ]);
  await client.submitAndWait([alice.id, bob.id], [
    createCommand(
      TEMPLATES.BilateralTrade,
      createBilateralTrade({
        cptyA: alice.id,
        cptyB: bob.id,
        tradeRef: "alice-bob",
        terms: aliceSealed.ciphertext,
        commitment: aliceSealed.commitment,
        auditors: [regulatorA.id], // scoped observer: this trade only
      }),
    ),
  ]);

  // Bob's separate trade with Carol: no auditor named at all.
  const bobCarolSealed = await sealLeg({ instrument: "IRS", notional: 20_000_000, risk: { "5Y": 4 } }, [
    { party: bob.id, publicKey: bob.keys.publicKey },
    { party: carol.id, publicKey: carol.keys.publicKey },
  ]);
  await client.submitAndWait([bob.id, carol.id], [
    createCommand(
      TEMPLATES.BilateralTrade,
      createBilateralTrade({
        cptyA: bob.id,
        cptyB: carol.id,
        tradeRef: "bob-carol",
        terms: bobCarolSealed.ciphertext,
        commitment: bobCarolSealed.commitment,
        auditors: [],
      }),
    ),
  ]);

  // Alice records the scoped disclosure grant itself (the on-ledger record of the
  // decryption scope she shared off-ledger with her regulator).
  await client.submitAndWait([alice.id], [
    createCommand(
      TEMPLATES.SelectiveAuditDisclosure,
      createSelectiveAuditDisclosure({
        participant: alice.id,
        auditor: regulatorA.id,
        encDecryptionScope: aliceSealed.wrappedKeys[regulatorA.id] ?? "",
      }),
    ),
  ]);

  const [regAView, regBView] = await Promise.all([
    client.activeContracts(regulatorA.id, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(regulatorB.id, { templateIds: [TEMPLATES.BilateralTrade] }),
  ]);

  const aliceBobFromRegA = regAView.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === "alice-bob");
  const bobCarolFromRegA = regAView.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === "bob-carol");

  let regulatorADecryptedInstrument: string | null = null;
  if (aliceBobFromRegA) {
    const decoded = decodeBilateralTrade(aliceBobFromRegA.createArgument);
    const opened = (await openLeg(
      { ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: aliceSealed.wrappedKeys },
      regulatorA.id,
      regulatorA.keys,
    )) as Record<string, unknown>;
    regulatorADecryptedInstrument = typeof opened["instrument"] === "string" ? opened["instrument"] : null;
  }

  return {
    regulatorASeesOwnTrade: aliceBobFromRegA !== undefined,
    regulatorADecryptedInstrument,
    regulatorASeesBobsTrade: bobCarolFromRegA !== undefined,
    regulatorBSeesAlicesTrade: regBView.some((c) => decodeBilateralTrade(c.createArgument).tradeRef === "alice-bob"),
  };
}
