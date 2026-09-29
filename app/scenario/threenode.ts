// A multilateral compression cycle across three participant nodes.
//
//   node A   hosts Firm A and Firm C
//   node H   hosts Firm B (a hosted, shared participant)
//   node Op  hosts only the operator
//
// Three trades form a ring that no pair can net on its own: A–B 100, B–C 60 and
// C–A 60 of one risk factor. Netted multilaterally, C is flat and A is +40 against
// B, so the cycle tears up all three and creates one replacement leg between A and
// B — a leg whose two signatories sit on different nodes. The operator opens and
// executes the cycle from a node that hosts no firm, so no trade is ever stored in
// its projection; it only handles the trades as disclosed ciphertext when it
// submits Execute.
//
// As in the two-node run, both sides' key material lives in this process and the
// sealed replacement leg is handed over in memory.
import { generateKeyPair, sealLeg, openLeg, type SealedLeg } from "../crypto/index";
import { prepareParticipation, type HeldLeg } from "../cycle/index";
import { match, type Trade as SolverTrade } from "../solver/index";
import { LedgerClient, createCommand, type CreatedEvent } from "../ledger/index";
import {
  TEMPLATES,
  CHOICES,
  createCompressionCycle,
  commitArg,
  executeArg,
  decodeBilateralTrade,
  decodeCompressionCycle,
} from "../model/index";
import { legPairsIn, disclose, positionsTornUp, readProposal } from "./cycle";
import { agreeTrade, namespaceOf, tradesOf, waitFor, type HostedParty } from "./crossnode";

export interface ThreeNodeConfig {
  readonly nodeA: LedgerClient; // hosts Firm A and Firm C; both are allocated here
  readonly nodeH: LedgerClient; // hosts Firm B (an existing party)
  readonly nodeOp: LedgerClient; // hosts only the operator; a party is allocated here
  readonly partyB: string;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
}

export interface ThreeNodeResult {
  readonly tradesTornUp: number;
  readonly replacementLegCount: number;
  readonly originalsActive: { readonly a: number; readonly b: number; readonly c: number };
  readonly replacementLegs: { readonly a: number; readonly b: number; readonly c: number };
  // The firm that nets out entirely holds nothing afterwards.
  readonly cTradeCount: number;
  // B opens the replacement leg on node H with its own key.
  readonly bDecryptedReplacementRisk: Record<string, number>;
  // What the operator's own node ever held for the operator: no trade, before or after.
  readonly operatorTradeCount: number;
  readonly operatorTradeEventsInHistory: number;
  readonly namespaces: { readonly a: string; readonly h: string; readonly op: string };
  readonly replacementSignatoryNamespaces: readonly string[];
  readonly maxActAsPerSubmission: number;
  readonly cycleId: string;
}

export async function runThreeNodeCycle(cfg: ThreeNodeConfig): Promise<ThreeNodeResult> {
  const pollMs = cfg.pollMs ?? 1500;
  const timeoutMs = cfg.timeoutMs ?? 60_000;
  const run = Math.random().toString(36).slice(2, 8);
  const cycleId = `x3-${run}`;

  const a: HostedParty = { id: await cfg.nodeA.allocateParty(`X3A-${run}`), keys: await generateKeyPair(), client: cfg.nodeA };
  const b: HostedParty = { id: cfg.partyB, keys: await generateKeyPair(), client: cfg.nodeH };
  const c: HostedParty = { id: await cfg.nodeA.allocateParty(`X3C-${run}`), keys: await generateKeyPair(), client: cfg.nodeA };
  const operator = await cfg.nodeOp.allocateParty(`X3Op-${run}`);
  const ns = { a: namespaceOf(a.id), h: namespaceOf(b.id), op: namespaceOf(operator) };
  if (new Set([ns.a, ns.h, ns.op]).size !== 3) throw new Error(`expected three distinct namespaces, got ${JSON.stringify(ns)}`);
  if (namespaceOf(c.id) !== ns.a) throw new Error("Firm C is expected on the same node as Firm A");

  // The ring. Each trade is proposed on its proposer's node and accepted on the
  // counterparty's node.
  const tAB = await agreeTrade(a, b, `${cycleId}-AB`, { "2Y": 100 }, pollMs, timeoutMs);
  const tBC = await agreeTrade(b, c, `${cycleId}-BC`, { "2Y": 60 }, pollMs, timeoutMs);
  const tCA = await agreeTrade(c, a, `${cycleId}-CA`, { "2Y": 60 }, pollMs, timeoutMs);
  const wrappedByContract = new Map<string, Readonly<Record<string, string>>>([
    [tAB.contractId, tAB.wrappedKeys],
    [tBC.contractId, tBC.wrappedKeys],
    [tCA.contractId, tCA.wrappedKeys],
  ]);

  const solverTrades: SolverTrade[] = [
    { id: tAB.contractId, a: a.id, b: b.id, risk: { "2Y": 100 } },
    { id: tBC.contractId, a: b.id, b: c.id, risk: { "2Y": 60 } },
    { id: tCA.contractId, a: c.id, b: a.id, risk: { "2Y": 60 } },
  ];
  const matched = match(solverTrades);
  const topology = matched.replacements.map((r): [string, string] => [r.a, r.b]);

  const byId = new Map<string, HostedParty>([[a.id, a], [b.id, b], [c.id, c]]);
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

  // The operator opens the cycle on its own node. The cycle carries no economic
  // terms; the firms are its observers until they commit.
  await cfg.nodeOp.submitAndWait([operator], [
    createCommand(
      TEMPLATES.CompressionCycle,
      createCompressionCycle({
        cycleId,
        operator,
        committed: [operator],
        toCommit: [a.id, b.id, c.id],
        teardown: [tAB.contractId, tBC.contractId, tCA.contractId],
        topology,
        participations: [],
        deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      }),
    ),
  ]);

  // Each firm reads the cycle from its own node, checks the plan against its own
  // decrypted trades, and commits there — waiting until earlier commits are visible
  // on its node so it commits on the current contract.
  const commitFrom = async (p: HostedParty, alreadyCommitted: readonly string[]): Promise<void> => {
    await waitFor(
      `cycle ${cycleId} on ${p.id}'s node`,
      async () => (await p.client.activeContracts(p.id, { templateIds: [TEMPLATES.CompressionCycle] })).find((x) => x.createArgument["cycleId"] === cycleId),
      (x) => x !== undefined && alreadyCommitted.every((q) => decodeCompressionCycle(x.createArgument).committed.includes(q)),
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
  await commitFrom(b, [a.id]);
  await commitFrom(c, [a.id, b.id]);

  // The operator's node holds none of the trades, so each is disclosed from the node
  // of a firm that holds it: B–C from node H, the other two from node A.
  const disclosures = [
    await disclose(a.client, a.id, tAB.contractId),
    await disclose(b.client, b.id, tBC.contractId),
    await disclose(c.client, c.id, tCA.contractId),
  ];
  const current = await waitFor(
    `fully committed cycle ${cycleId} on the operator's node`,
    async () => (await cfg.nodeOp.activeContracts(operator, { templateIds: [TEMPLATES.CompressionCycle] })).find((x) => x.createArgument["cycleId"] === cycleId),
    (x) => x !== undefined && decodeCompressionCycle(x.createArgument).toCommit.length === 0,
    pollMs,
    timeoutMs,
  );
  await cfg.nodeOp.exercise(operator, TEMPLATES.CompressionCycle, current!.contractId, CHOICES.Execute, executeArg(), { disclosedContracts: disclosures });

  // Outcome, read by each firm from its own node.
  const originals = new Set([tAB.contractId, tBC.contractId, tCA.contractId]);
  const isReplacement = (x: CreatedEvent): boolean => decodeBilateralTrade(x.createArgument).tradeRef.startsWith(`${cycleId}/`);
  const gone = (xs: CreatedEvent[]): boolean => !xs.some((x) => originals.has(x.contractId));
  const aAfter = await waitFor("settlement on node A (A)", () => tradesOf(a), (xs) => gone(xs) && xs.some(isReplacement), pollMs, timeoutMs);
  const bAfter = await waitFor("settlement on node H (B)", () => tradesOf(b), (xs) => gone(xs) && xs.some(isReplacement), pollMs, timeoutMs);
  const cAfter = await waitFor("settlement on node A (C)", () => tradesOf(c), gone, pollMs, timeoutMs);

  // The operator's own node: no active trade, and no trade event anywhere in the
  // operator's history on that node.
  const opActive = await cfg.nodeOp.activeContracts(operator, { templateIds: [TEMPLATES.BilateralTrade] });
  const opHistory = await cfg.nodeOp.updates(operator, { templateIds: [TEMPLATES.BilateralTrade] });
  const opTradeEvents = opHistory.reduce((n, u) => n + u.events.length, 0);

  const bLeg = bAfter.find(isReplacement)!;
  const decoded = decodeBilateralTrade(bLeg.createArgument);
  const opened = (await openLeg(
    { ciphertext: decoded.terms, commitment: decoded.commitment, wrappedKeys: sealedFor(decoded.cptyA, decoded.cptyB).wrappedKeys },
    b.id,
    b.keys,
  )) as { risk?: Record<string, number> };

  const count = (xs: CreatedEvent[], f: (x: CreatedEvent) => boolean): number => xs.filter(f).length;
  return {
    tradesTornUp: matched.teardown.length,
    replacementLegCount: matched.replacements.length,
    originalsActive: {
      a: count(aAfter, (x) => originals.has(x.contractId)),
      b: count(bAfter, (x) => originals.has(x.contractId)),
      c: count(cAfter, (x) => originals.has(x.contractId)),
    },
    replacementLegs: { a: count(aAfter, isReplacement), b: count(bAfter, isReplacement), c: count(cAfter, isReplacement) },
    cTradeCount: cAfter.filter((x) => decodeBilateralTrade(x.createArgument).tradeRef.startsWith(cycleId)).length,
    bDecryptedReplacementRisk: opened.risk ?? {},
    operatorTradeCount: opActive.length,
    operatorTradeEventsInHistory: opTradeEvents,
    namespaces: ns,
    replacementSignatoryNamespaces: [...new Set(bLeg.signatories.map(namespaceOf))].sort(),
    maxActAsPerSubmission: 1,
    cycleId,
  };
}
