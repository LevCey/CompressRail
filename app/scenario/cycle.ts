// The full compression-cycle scenario, driven end to end through the ledger client
// against a live Canton ledger. It mirrors the Daml fixture (an offsetting A-B-C
// ring compressed to a single A-B replacement leg) but with everything genuinely
// computed off-ledger: real encryption, a real per-node risk check, and the real
// matching algorithm — nothing hard-coded.
//
// For each replacement leg, one counterparty (canonically, the lexicographically
// smaller party id) seals the payload and shares it with the other off-ledger — the
// same "one side authors, both sides commit to the same commitment" flow the Daml
// `Execute` choice checks (§3.5). The point this proves live: the operator opens and
// executes the cycle, yet at every step its ledger projection contains no bilateral
// trade and no cleartext economic term — only ciphertext, commitments, topology, and
// boolean attestations.
import { generateKeyPair, sealLeg, openLeg, type KeyPair, type SealedLeg } from "../crypto/index";
import { prepareParticipation, type HeldLeg } from "../cycle/index";
import { match, type Trade as SolverTrade } from "../solver/index";
import { LedgerClient, createCommand, type DisclosedContract } from "../ledger/index";
import {
  TEMPLATES,
  CHOICES,
  createBilateralTrade,
  createCompressionCycle,
  commitArg,
  executeArg,
  decodeBilateralTrade,
} from "../model/index";

export interface CycleResult {
  readonly operatorTradeCount: number;
  readonly aliceTradeCount: number;
  readonly bobTradeCount: number;
  readonly carolTradeCount: number;
  readonly replacementLegCount: number;
  // True if Alice could decrypt the replacement leg she holds after the cycle and it
  // carried real economic content — a decryption-success check, not a notional.
  readonly aliceDecryptedReplacementLeg: boolean;
  // The real party ids allocated for this run, so a caller (e.g. the demo) can
  // drive further live reads — the Ledger/X-ray view, the privacy-matrix
  // scoreboard — against the exact parties this cycle actually ran on.
  readonly parties: {
    readonly operator: string;
    readonly alice: string;
    readonly bob: string;
    readonly carol: string;
  };
}

interface Party {
  readonly id: string;
  readonly keys: KeyPair;
}

async function writeTrade(client: LedgerClient, x: Party, y: Party, tradeRef: string, risk: Record<string, number>): Promise<string> {
  const sealed = await sealLeg(
    { instrument: "IRS", tradeRef, notional: 100_000_000, risk },
    [{ party: x.id, publicKey: x.keys.publicKey }, { party: y.id, publicKey: y.keys.publicKey }],
  );
  await client.submitAndWait([x.id, y.id], [
    createCommand(
      TEMPLATES.BilateralTrade,
      createBilateralTrade({ cptyA: x.id, cptyB: y.id, tradeRef, terms: sealed.ciphertext, commitment: sealed.commitment, auditors: [] }),
    ),
  ]);
  const acs = await client.activeContracts(x.id, { templateIds: [TEMPLATES.BilateralTrade] });
  const found = acs.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === tradeRef);
  if (!found) throw new Error(`trade ${tradeRef} not found in ${x.id}'s projection after create`);
  return found.contractId;
}

async function disclose(client: LedgerClient, party: string, contractId: string): Promise<DisclosedContract> {
  const acs = await client.activeContracts(party, { templateIds: [TEMPLATES.BilateralTrade] });
  const found = acs.find((c) => c.contractId === contractId);
  if (!found) throw new Error(`cannot disclose ${contractId}: not in ${party}'s projection`);
  // disclosedContracts requires the full package-id-qualified template id (the
  // package-name form `#compressrail:...` used elsewhere is rejected here); the
  // active-contracts read already returns the full id, so it is reused as-is.
  return { contractId: found.contractId, templateId: found.templateId, createdEventBlob: found.createdEventBlob, synchronizerId: found.synchronizerId };
}

export async function runCompressionCycle(client: LedgerClient): Promise<CycleResult> {
  const run = Math.random().toString(36).slice(2, 8);
  const alice: Party = { id: await client.allocateParty(`Alice-${run}`), keys: await generateKeyPair() };
  const bob: Party = { id: await client.allocateParty(`Bob-${run}`), keys: await generateKeyPair() };
  const carol: Party = { id: await client.allocateParty(`Carol-${run}`), keys: await generateKeyPair() };
  const operator = await client.allocateParty(`Operator-${run}`);
  const byId = new Map<string, Party>([[alice.id, alice], [bob.id, bob], [carol.id, carol]]);

  // An offsetting ring, same shape as the Daml fixture: A-B, B-C, C-A, all 100 of a
  // single risk factor — a closed ring that fully nets to zero.
  const tAB = await writeTrade(client, alice, bob, "AB", { "2Y": 100 });
  const tBC = await writeTrade(client, bob, carol, "BC", { "2Y": 100 });
  const tCA = await writeTrade(client, carol, alice, "CA", { "2Y": 100 });

  // The matching stand-in computes the real teardown/replacement topology from the
  // trades' actual risk — not hard-coded. The ring is closed, so it fully compresses.
  const solverTrades: SolverTrade[] = [
    { id: tAB, a: alice.id, b: bob.id, risk: { "2Y": 100 } },
    { id: tBC, a: bob.id, b: carol.id, risk: { "2Y": 100 } },
    { id: tCA, a: carol.id, b: alice.id, risk: { "2Y": 100 } },
  ];
  const matched = match(solverTrades);
  const topology = matched.replacements.map((r): [string, string] => [r.a, r.b]);

  // One counterparty per replacement leg seals it and shares the sealed payload with
  // the other off-ledger — both sides then commit to the same commitment.
  const sealedByPair = new Map<string, SealedLeg>();
  for (const r of matched.replacements) {
    const x = byId.get(r.a)!;
    const y = byId.get(r.b)!;
    const sealed = await sealLeg({ instrument: "IRS", risk: r.risk }, [
      { party: x.id, publicKey: x.keys.publicKey },
      { party: y.id, publicKey: y.keys.publicKey },
    ]);
    sealedByPair.set(`${r.a}\u0000${r.b}`, sealed);
  }
  const sealedFor = (a: string, b: string): SealedLeg => {
    const direct = sealedByPair.get(`${a}\u0000${b}`);
    if (direct) return direct;
    const found = sealedByPair.get(`${b}\u0000${a}`);
    if (!found) throw new Error(`no sealed replacement leg for ${a}-${b}`);
    return found;
  };
  const heldLegsFor = (party: Party): HeldLeg[] =>
    matched.replacements
      .filter((r) => r.a === party.id || r.b === party.id)
      .map((r) => ({ counterparty: r.a === party.id ? r.b : r.a, sealed: sealedFor(r.a, r.b) }));

  const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await client.submitAndWait([operator], [
    createCommand(
      TEMPLATES.CompressionCycle,
      createCompressionCycle({
        cycleId: "cycle-1",
        operator,
        committed: [operator],
        toCommit: [alice.id, bob.id, carol.id],
        teardown: [tAB, tBC, tCA],
        topology,
        participations: [],
        deadline,
      }),
    ),
  ]);

  const findCycle = async (): Promise<string> => {
    const acs = await client.activeContracts(operator, { templateIds: [TEMPLATES.CompressionCycle] });
    const found = acs.find((c) => c.createArgument["cycleId"] === "cycle-1");
    if (!found) throw new Error("cycle not found in operator's projection");
    return found.contractId;
  };

  // Each participant runs its real per-node check over the legs it would hold, and
  // only if it passes, commits its leg commitments + ciphertext + attestation.
  for (const p of [alice, bob, carol]) {
    const result = await prepareParticipation({
      participant: p.id,
      keyPair: p.keys,
      before: [{ legId: "pre-cycle", risk: { "2Y": 0 } }], // flat before: the ring nets to zero for every party
      legs: heldLegsFor(p),
      tolerance: 0,
    });
    if (result.decision !== "commit") throw new Error(`${p.id} declined: residual magnitude ${result.assessment.magnitude}`);
    const cycleId = await findCycle();
    await client.exercise(p.id, TEMPLATES.CompressionCycle, cycleId, CHOICES.Commit, commitArg(p.id, result.submission.legs, true));
  }

  // The operator is not a stakeholder of the nominated trades, so each stakeholder
  // discloses its trade for the Execute submission — the disclosed payload is
  // ciphertext, opaque to the operator; disclosure does not make it a stakeholder.
  const disclosures = await Promise.all([disclose(client, alice.id, tAB), disclose(client, bob.id, tBC), disclose(client, carol.id, tCA)]);

  const cycleId = await findCycle();
  await client.exercise(operator, TEMPLATES.CompressionCycle, cycleId, CHOICES.Execute, executeArg(), { disclosedContracts: disclosures });

  const [operatorTrades, aliceTrades, bobTrades, carolTrades] = await Promise.all([
    client.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(alice.id, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(bob.id, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(carol.id, { templateIds: [TEMPLATES.BilateralTrade] }),
  ]);

  // Alice decrypts whatever replacement leg she now holds (there may be none, if
  // she nets out of the compressed topology entirely) and confirms it carries real
  // economic content — proving the on-ledger ciphertext round-trips, not a notional.
  let aliceDecryptedReplacementLeg = false;
  if (aliceTrades.length > 0) {
    const decoded = decodeBilateralTrade(aliceTrades[0]!.createArgument);
    const opened = await openLeg({ ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: sealedFor(decoded.cptyA, decoded.cptyB).wrappedKeys }, alice.id, alice.keys);
    aliceDecryptedReplacementLeg = typeof (opened as Record<string, unknown>)["risk"] === "object";
  }

  return {
    operatorTradeCount: operatorTrades.length,
    aliceTradeCount: aliceTrades.length,
    bobTradeCount: bobTrades.length,
    carolTradeCount: carolTrades.length,
    replacementLegCount: matched.replacements.length,
    aliceDecryptedReplacementLeg,
    parties: { operator, alice: alice.id, bob: bob.id, carol: carol.id },
  };
}
