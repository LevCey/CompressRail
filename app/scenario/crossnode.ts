// A compression cycle across two participant nodes, driven by one ledger client per
// node. Party A and the operator are hosted on node A; party H is hosted on node H.
// Every submission acts for exactly one party and goes to the node that hosts it —
// a ledger user cannot act for a party hosted elsewhere.
//
// The two trades only partly offset (100 against 60 of one risk factor), so the cycle
// tears both up and creates one replacement leg of 40 between A and H. That leg is
// signed by a party on each node, so creating it needs the confirmation of both
// participants inside the same atomic Execute.
//
// What stays simulated: both sides' off-ledger key material lives in this one
// process, and the sealed replacement leg is handed from one side to the other in
// memory rather than over a real off-ledger channel.
import { generateKeyPair, sealLeg, openLeg, type SealedLeg } from "../crypto/index";
import { prepareParticipation, type HeldLeg } from "../cycle/index";
import { match, type Trade as SolverTrade } from "../solver/index";
import { LedgerClient, createCommand, exerciseCommand, type CreatedEvent } from "../ledger/index";
import {
  TEMPLATES,
  CHOICES,
  createTradeProposal,
  createCompressionCycle,
  commitArg,
  executeArg,
  decodeBilateralTrade,
  decodeCompressionCycle,
} from "../model/index";
import { legPairsIn, disclose, positionsTornUp, readProposal, type Party } from "./cycle";

// A party together with the client of the node that hosts it.
export interface HostedParty extends Party {
  readonly client: LedgerClient;
}

export interface CrossNodeConfig {
  readonly nodeA: LedgerClient; // hosts A and the operator; parties are allocated here
  readonly nodeH: LedgerClient; // hosts H
  readonly partyH: string; // an existing party on node H, usable by nodeH's user
  readonly pollMs?: number;
  readonly timeoutMs?: number;
}

export interface CrossNodeResult {
  readonly tradesTornUp: number;
  readonly replacementLegCount: number;
  // Seen by each party from its own node after Execute.
  readonly aOriginalsActive: number;
  readonly hOriginalsActive: number;
  readonly aReplacementLegs: number;
  readonly hReplacementLegs: number;
  // H opens the replacement leg on node H with its own key and finds the net risk.
  readonly hDecryptedReplacementRisk: Record<string, number>;
  readonly operatorTradeCount: number;
  // The replacement leg's two signatories live under two different namespaces.
  readonly replacementSignatoryNamespaces: readonly string[];
  readonly maxActAsPerSubmission: number;
  readonly cycleId: string;
  readonly parties: { readonly operator: string; readonly a: string; readonly h: string };
}

export const namespaceOf = (party: string): string => party.split("::")[1] ?? "";

// Node H's projection is read through its own ledger API, which can trail node A's by
// a moment after a submission completes on node A. Poll rather than assume.
export async function waitFor<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, pollMs: number, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export const tradesOf = (p: HostedParty): Promise<CreatedEvent[]> =>
  p.client.activeContracts(p.id, { templateIds: [TEMPLATES.BilateralTrade] });

// Propose on the proposer's node, accept on the counterparty's node. Returns the
// trade's contract id and the wrapped keys both sides hold off-ledger.
export async function agreeTrade(
  proposer: HostedParty,
  counterparty: HostedParty,
  tradeRef: string,
  risk: Record<string, number>,
  pollMs: number,
  timeoutMs: number,
): Promise<{ contractId: string; wrappedKeys: Readonly<Record<string, string>> }> {
  const sealed = await sealLeg({ instrument: "IRS", tradeRef, notional: 100_000_000, risk }, [
    { party: proposer.id, publicKey: proposer.keys.publicKey },
    { party: counterparty.id, publicKey: counterparty.keys.publicKey },
  ]);
  await proposer.client.submitAndWait([proposer.id], [
    createCommand(
      TEMPLATES.TradeProposal,
      createTradeProposal({ proposer: proposer.id, counterparty: counterparty.id, tradeRef, terms: sealed.ciphertext, commitment: sealed.commitment, auditors: [] }),
    ),
  ]);
  const proposals = await waitFor(
    `proposal ${tradeRef} on the counterparty's node`,
    () => counterparty.client.activeContracts(counterparty.id, { templateIds: [TEMPLATES.TradeProposal] }),
    (cs) => cs.some((c) => c.createArgument["tradeRef"] === tradeRef),
    pollMs,
    timeoutMs,
  );
  const proposal = proposals.find((c) => c.createArgument["tradeRef"] === tradeRef)!;
  await counterparty.client.submitAndWait([counterparty.id], [
    exerciseCommand(TEMPLATES.TradeProposal, proposal.contractId, CHOICES.Accept, {}),
  ]);
  const trades = await waitFor(
    `trade ${tradeRef} on the proposer's node`,
    () => tradesOf(proposer),
    (cs) => cs.some((c) => decodeBilateralTrade(c.createArgument).tradeRef === tradeRef),
    pollMs,
    timeoutMs,
  );
  const trade = trades.find((c) => decodeBilateralTrade(c.createArgument).tradeRef === tradeRef)!;
  return { contractId: trade.contractId, wrappedKeys: sealed.wrappedKeys };
}

export async function runCrossNodeCycle(cfg: CrossNodeConfig): Promise<CrossNodeResult> {
  const pollMs = cfg.pollMs ?? 1500;
  const timeoutMs = cfg.timeoutMs ?? 45_000;
  const run = Math.random().toString(36).slice(2, 8);
  const cycleId = `xn-${run}`;

  const a: HostedParty = { id: await cfg.nodeA.allocateParty(`XA-${run}`), keys: await generateKeyPair(), client: cfg.nodeA };
  const operator = await cfg.nodeA.allocateParty(`XOp-${run}`);
  const h: HostedParty = { id: cfg.partyH, keys: await generateKeyPair(), client: cfg.nodeH };
  if (namespaceOf(a.id) === namespaceOf(h.id)) throw new Error("A and H share a namespace — this would not be a cross-node run");

  // Two trades that only partly offset, one proposed from each node.
  const t1 = await agreeTrade(a, h, `${cycleId}-AH`, { "2Y": 100 }, pollMs, timeoutMs); // cptyA = A
  const t2 = await agreeTrade(h, a, `${cycleId}-HA`, { "2Y": 60 }, pollMs, timeoutMs); // cptyA = H
  const wrappedByContract = new Map<string, Readonly<Record<string, string>>>([
    [t1.contractId, t1.wrappedKeys],
    [t2.contractId, t2.wrappedKeys],
  ]);

  // Real matching over the real risk: A is net +40 against H.
  const solverTrades: SolverTrade[] = [
    { id: t1.contractId, a: a.id, b: h.id, risk: { "2Y": 100 } },
    { id: t2.contractId, a: h.id, b: a.id, risk: { "2Y": 60 } },
  ];
  const matched = match(solverTrades);
  const topology = matched.replacements.map((r): [string, string] => [r.a, r.b]);

  // One side seals each replacement leg; the sealed payload reaches the other side
  // off-ledger (here: in memory) and both commit to the same commitment.
  const byId = new Map<string, HostedParty>([[a.id, a], [h.id, h]]);
  const sealedByPair = new Map<string, SealedLeg>();
  for (const r of matched.replacements) {
    const x = byId.get(r.a)!;
    const y = byId.get(r.b)!;
    sealedByPair.set(
      `${r.a}\u0000${r.b}`,
      await sealLeg({ instrument: "IRS", risk: r.risk }, [
        { party: x.id, publicKey: x.keys.publicKey },
        { party: y.id, publicKey: y.keys.publicKey },
      ]),
    );
  }
  const sealedFor = (p: string, q: string): SealedLeg => {
    const s = sealedByPair.get(`${p}\u0000${q}`) ?? sealedByPair.get(`${q}\u0000${p}`);
    if (!s) throw new Error(`no sealed replacement leg for ${p}-${q}`);
    return s;
  };

  await cfg.nodeA.submitAndWait([operator], [
    createCommand(
      TEMPLATES.CompressionCycle,
      createCompressionCycle({
        cycleId,
        operator,
        committed: [operator],
        toCommit: [a.id, h.id],
        teardown: [t1.contractId, t2.contractId],
        topology,
        participations: [],
        deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      }),
    ),
  ]);

  // Each participant reads the cycle from its own node, assesses the proposed plan
  // against its own decrypted trades, and commits on its own node. H waits until A's
  // commit is visible on node H, so it commits on the current contract.
  const commitFrom = async (p: HostedParty, alreadyCommitted: readonly string[]): Promise<void> => {
    await waitFor(
      `cycle ${cycleId} on ${p.id}'s node`,
      async () => {
        const cs = await p.client.activeContracts(p.id, { templateIds: [TEMPLATES.CompressionCycle] });
        return cs.find((c) => c.createArgument["cycleId"] === cycleId);
      },
      (c) => c !== undefined && alreadyCommitted.every((q) => decodeCompressionCycle(c.createArgument).committed.includes(q)),
      pollMs,
      timeoutMs,
    );
    const proposal = await readProposal(p.client, p.id, cycleId);
    const before = await positionsTornUp(p.client, p, proposal.teardown, wrappedByContract);
    const legs: HeldLeg[] = legPairsIn(proposal.topology, p.id).map(({ counterparty, cptyA }) => ({ counterparty, cptyA, sealed: sealedFor(p.id, counterparty) }));
    const result = await prepareParticipation({ participant: p.id, keyPair: p.keys, before, legs, tolerance: 0 });
    if (result.decision !== "commit") throw new Error(`${p.id} declined: residual magnitude ${result.assessment.magnitude}`);
    await p.client.exercise(p.id, TEMPLATES.CompressionCycle, proposal.contractId, CHOICES.Commit, commitArg(p.id, result.submission.legs, true));
  };
  await commitFrom(a, []);
  await commitFrom(h, [a.id]);

  // The operator is a stakeholder of neither trade. Each trade is disclosed from the
  // projection of the party that proposed it — t2 from H's node, so the Execute on
  // node A resolves a contract blob that was read from the other participant.
  const disclosures = [await disclose(a.client, a.id, t1.contractId), await disclose(h.client, h.id, t2.contractId)];
  const current = await waitFor(
    `fully committed cycle ${cycleId} on node A`,
    async () => (await cfg.nodeA.activeContracts(operator, { templateIds: [TEMPLATES.CompressionCycle] })).find((c) => c.createArgument["cycleId"] === cycleId),
    (c) => c !== undefined && decodeCompressionCycle(c.createArgument).toCommit.length === 0,
    pollMs,
    timeoutMs,
  );
  await cfg.nodeA.exercise(operator, TEMPLATES.CompressionCycle, current!.contractId, CHOICES.Execute, executeArg(), { disclosedContracts: disclosures });

  // Read the outcome from each party's own node.
  const originals = new Set([t1.contractId, t2.contractId]);
  const isReplacement = (c: CreatedEvent): boolean => decodeBilateralTrade(c.createArgument).tradeRef.startsWith(`${cycleId}/`);
  const settled = (cs: CreatedEvent[]): boolean => !cs.some((c) => originals.has(c.contractId)) && cs.some(isReplacement);
  const aAfter = await waitFor("settlement on node A", () => tradesOf(a), settled, pollMs, timeoutMs);
  const hAfter = await waitFor("settlement on node H", () => tradesOf(h), settled, pollMs, timeoutMs);
  const operatorAfter = await cfg.nodeA.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] });

  const hLeg = hAfter.find(isReplacement)!;
  const decoded = decodeBilateralTrade(hLeg.createArgument);
  const opened = (await openLeg(
    { ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: sealedFor(decoded.cptyA, decoded.cptyB).wrappedKeys },
    h.id,
    h.keys,
  )) as { risk?: Record<string, number> };

  return {
    tradesTornUp: matched.teardown.length,
    replacementLegCount: matched.replacements.length,
    aOriginalsActive: aAfter.filter((c) => originals.has(c.contractId)).length,
    hOriginalsActive: hAfter.filter((c) => originals.has(c.contractId)).length,
    aReplacementLegs: aAfter.filter(isReplacement).length,
    hReplacementLegs: hAfter.filter(isReplacement).length,
    hDecryptedReplacementRisk: opened.risk ?? {},
    operatorTradeCount: operatorAfter.length,
    replacementSignatoryNamespaces: [...new Set(hLeg.signatories.map(namespaceOf))].sort(),
    maxActAsPerSubmission: 1,
    cycleId,
    parties: { operator, a: a.id, h: h.id },
  };
}
