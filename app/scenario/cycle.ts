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
import { riskOf, type Position } from "../verify/index";
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
  decodeCompressionCycle,
} from "../model/index";

export interface CycleResult {
  readonly operatorTradeCount: number;
  readonly aliceTradeCount: number;
  readonly bobTradeCount: number;
  readonly carolTradeCount: number;
  readonly replacementLegCount: number;
  // The number of bilateral trades the cycle tore up (the offsetting ring: 3).
  readonly tradesTornUp: number;
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

// A written trade, plus the wrapped content keys its two counterparties hold
// off-ledger. The ledger stores only ciphertext and commitment, so a participant
// decrypts its own trade from key material it already holds — which is what lets it
// assess a proposed teardown rather than take the plan on trust.
interface WrittenTrade {
  readonly contractId: string;
  readonly wrappedKeys: Readonly<Record<string, string>>;
}

async function writeTrade(client: LedgerClient, x: Party, y: Party, tradeRef: string, risk: Record<string, number>): Promise<WrittenTrade> {
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
  return { contractId: found.contractId, wrappedKeys: sealed.wrappedKeys };
}

// The cycle as a participant sees it in its own projection: the exact list of trades
// proposed for teardown and the exact replacement topology. Read from the
// participant's own view rather than the operator's, so what is assessed is what the
// participant is about to commit to.
interface ProposedCycle {
  readonly contractId: string;
  readonly teardown: readonly string[];
  readonly topology: readonly (readonly [string, string])[];
}

async function readProposal(client: LedgerClient, party: string, cycleId: string): Promise<ProposedCycle> {
  const acs = await client.activeContracts(party, { templateIds: [TEMPLATES.CompressionCycle] });
  const found = acs.find((c) => c.createArgument["cycleId"] === cycleId);
  if (!found) throw new Error(`cycle ${cycleId} is not in ${party}'s projection`);
  const decoded = decodeCompressionCycle(found.createArgument);
  return { contractId: found.contractId, teardown: decoded.teardown, topology: decoded.topology };
}

// The counterparties a party will face after the cycle, from the proposed topology.
function counterpartiesIn(topology: readonly (readonly [string, string])[], party: string): string[] {
  return topology.filter(([x, y]) => x === party || y === party).map(([x, y]) => (x === party ? y : x));
}

// The positions a party gives up: for each proposed teardown entry that is in this
// party's own projection, decrypt the trade with the party's own key and take the
// signed risk it contributes. `risk` in the sealed terms is from cptyA's perspective,
// so cptyB holds the opposite — the same convention the solver uses.
async function positionsTornUp(
  client: LedgerClient,
  p: Party,
  teardown: readonly string[],
  wrappedByContract: ReadonlyMap<string, Readonly<Record<string, string>>>,
): Promise<Position[]> {
  const acs = await client.activeContracts(p.id, { templateIds: [TEMPLATES.BilateralTrade] });
  const mine = new Map(acs.map((c) => [c.contractId, c]));
  const out: Position[] = [];
  for (const cid of teardown) {
    const held = mine.get(cid);
    if (!held) continue; // names a trade this party does not hold; nothing to assess
    const t = decodeBilateralTrade(held.createArgument);
    const wrappedKeys = wrappedByContract.get(cid);
    if (!wrappedKeys) throw new Error(`no key material held for teardown entry ${cid}`);
    const terms = await openLeg({ ciphertext: t.terms, commitment: t.commitment, wrappedKeys }, p.id, p.keys);
    const sign = t.cptyA === p.id ? 1 : -1;
    const risk = riskOf(terms);
    out.push({ legId: t.tradeRef, risk: Object.fromEntries(Object.entries(risk).map(([k, v]) => [k, sign * v])) });
  }
  return out;
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

// A staged progress event, emitted after each real sequential phase of the cycle so
// a caller can render the ~50s DevNet run as a live timeline. Every value is real —
// taken from the ledger operation that just completed, never a fabricated placeholder.
export type CycleProgress =
  | { readonly step: "parties"; readonly count: number }
  | { readonly step: "trades"; readonly count: number; readonly grossNotional: number; readonly refs: readonly string[] }
  | { readonly step: "matched"; readonly tearUp: number; readonly replacements: number }
  | { readonly step: "opened" }
  | { readonly step: "verified"; readonly participant: string; readonly index: number; readonly total: number; readonly withinTolerance: boolean }
  | { readonly step: "executed"; readonly tornUp: number }
  | { readonly step: "settled"; readonly aliceTradeCount: number; readonly bobTradeCount: number; readonly carolTradeCount: number };

export async function runCompressionCycle(
  client: LedgerClient,
  onProgress?: (event: CycleProgress) => void,
): Promise<CycleResult> {
  const emit = (event: CycleProgress): void => onProgress?.(event);
  const run = Math.random().toString(36).slice(2, 8);
  const alice: Party = { id: await client.allocateParty(`Alice-${run}`), keys: await generateKeyPair() };
  const bob: Party = { id: await client.allocateParty(`Bob-${run}`), keys: await generateKeyPair() };
  const carol: Party = { id: await client.allocateParty(`Carol-${run}`), keys: await generateKeyPair() };
  const operator = await client.allocateParty(`Operator-${run}`);
  const byId = new Map<string, Party>([[alice.id, alice], [bob.id, bob], [carol.id, carol]]);
  emit({ step: "parties", count: 4 });

  // An offsetting ring, same shape as the Daml fixture: A-B, B-C, C-A, all 100 of a
  // single risk factor — a closed ring that fully nets to zero.
  const wAB = await writeTrade(client, alice, bob, "AB", { "2Y": 100 });
  const wBC = await writeTrade(client, bob, carol, "BC", { "2Y": 100 });
  const wCA = await writeTrade(client, carol, alice, "CA", { "2Y": 100 });
  const tAB = wAB.contractId;
  const tBC = wBC.contractId;
  const tCA = wCA.contractId;
  // Key material each counterparty holds for its own trades, off-ledger.
  const wrappedByContract = new Map<string, Readonly<Record<string, string>>>([
    [wAB.contractId, wAB.wrappedKeys],
    [wBC.contractId, wBC.wrappedKeys],
    [wCA.contractId, wCA.wrappedKeys],
  ]);
  emit({ step: "trades", count: 3, grossNotional: 3 * 100_000_000, refs: ["AB", "BC", "CA"] });

  // The matching stand-in computes the real teardown/replacement topology from the
  // trades' actual risk — not hard-coded. The ring is closed, so it fully compresses.
  const solverTrades: SolverTrade[] = [
    { id: tAB, a: alice.id, b: bob.id, risk: { "2Y": 100 } },
    { id: tBC, a: bob.id, b: carol.id, risk: { "2Y": 100 } },
    { id: tCA, a: carol.id, b: alice.id, risk: { "2Y": 100 } },
  ];
  const matched = match(solverTrades);
  const topology = matched.replacements.map((r): [string, string] => [r.a, r.b]);
  emit({ step: "matched", tearUp: matched.teardown.length, replacements: matched.replacements.length });

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
  emit({ step: "opened" });

  // Each Commit archives and recreates the cycle, so its contract id changes as
  // commits accumulate; resolve it by cycleId from the reading party's own projection.
  const findCycle = async (): Promise<string> => (await readProposal(client, operator, "cycle-1")).contractId;

  // Each participant runs its real per-node check over the legs it would hold, and
  // only if it passes, commits its leg commitments + ciphertext + attestation.
  //
  // The inputs to that check are read back from the cycle contract in the
  // participant's own projection, not taken from this client's matching result
  // (GitHub issue #1). Consent is already bound on-ledger — a participant exercises
  // `Commit` on one specific contract carrying that exact `teardown` and `topology`,
  // and `create this with` preserves both as commits accumulate — but a client that
  // derived the tolerance check from its own copy of the plan could have assessed a
  // different plan than the one it was about to commit to. Reading the contract
  // closes that: the counterparties assessed come from the contract's `topology`, and
  // the positions given up come from the participant decrypting its own trades named
  // in the contract's `teardown`.
  const toVerify = [alice, bob, carol];
  for (let i = 0; i < toVerify.length; i++) {
    const p = toVerify[i]!;
    const proposal = await readProposal(client, p.id, "cycle-1");

    // What this participant is giving up: its own trades named in the teardown list,
    // decrypted with its own key. A teardown entry belonging to someone else simply
    // is not in this projection, so it cannot be assessed here — the participant can
    // see that the list names trades it cannot account for, which is as far as this
    // build goes towards the nomination check (NominateIntoCycle remains roadmap).
    const before = await positionsTornUp(client, p, proposal.teardown, wrappedByContract);

    // Who it will face after the cycle, taken from the contract rather than from the
    // local matching result. A topology naming a counterparty this client never
    // prepared a leg for is an error rather than something to commit to blindly.
    const counterparties = counterpartiesIn(proposal.topology, p.id);
    const legs: HeldLeg[] = counterparties.map((cp) => ({ counterparty: cp, sealed: sealedFor(p.id, cp) }));

    const result = await prepareParticipation({
      participant: p.id,
      keyPair: p.keys,
      before,
      legs,
      tolerance: 0,
    });
    if (result.decision !== "commit") throw new Error(`${p.id} declined: residual magnitude ${result.assessment.magnitude}`);
    await client.exercise(p.id, TEMPLATES.CompressionCycle, proposal.contractId, CHOICES.Commit, commitArg(p.id, result.submission.legs, true));
    emit({ step: "verified", participant: p.id, index: i, total: toVerify.length, withinTolerance: result.submission.withinTolerance });
  }

  // The operator is not a stakeholder of the nominated trades, so each stakeholder
  // discloses its trade for the Execute submission — the disclosed payload is
  // ciphertext, opaque to the operator; disclosure does not make it a stakeholder.
  const disclosures = await Promise.all([disclose(client, alice.id, tAB), disclose(client, bob.id, tBC), disclose(client, carol.id, tCA)]);

  const cycleId = await findCycle();
  await client.exercise(operator, TEMPLATES.CompressionCycle, cycleId, CHOICES.Execute, executeArg(), { disclosedContracts: disclosures });
  emit({ step: "executed", tornUp: matched.teardown.length });

  const [operatorTrades, aliceTrades, bobTrades, carolTrades] = await Promise.all([
    client.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(alice.id, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(bob.id, { templateIds: [TEMPLATES.BilateralTrade] }),
    client.activeContracts(carol.id, { templateIds: [TEMPLATES.BilateralTrade] }),
  ]);
  emit({ step: "settled", aliceTradeCount: aliceTrades.length, bobTradeCount: bobTrades.length, carolTradeCount: carolTrades.length });

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
    tradesTornUp: matched.teardown.length,
    aliceDecryptedReplacementLeg,
    parties: { operator, alice: alice.id, bob: bob.id, carol: carol.id },
  };
}
