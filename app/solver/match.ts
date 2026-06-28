// The cycle-matching algorithm (CTD-4).
//
// netPositions: each party's net risk across the nominated trades. A closed set of
// bilateral trades nets to zero across all parties per factor.
//
// match: tear up the nominated trades and rebuild each party's net position with a
// minimal set of replacement legs. Per risk factor it greedily pairs the parties
// that are net-long against those that are net-short (the classic minimum-transfer
// settlement), so the result preserves every party's net risk while collapsing the
// gross web of trades. Deterministic: factors and parties are processed in sorted
// order.
import { EPS, addInto, prune } from "./risk";
import type { MatchResult, Replacement, RiskVector, Trade } from "./types";

export function netPositions(trades: readonly Trade[]): Record<string, RiskVector> {
  const acc: Record<string, Record<string, number>> = {};
  for (const t of trades) {
    const na = (acc[t.a] ??= {});
    addInto(na, t.risk, +1);
    const nb = (acc[t.b] ??= {});
    addInto(nb, t.risk, -1);
  }
  const out: Record<string, RiskVector> = {};
  for (const [party, vec] of Object.entries(acc)) {
    out[party] = prune(vec);
  }
  return out;
}

export function match(trades: readonly Trade[]): MatchResult {
  const net = netPositions(trades);

  const factors = new Set<string>();
  for (const vec of Object.values(net)) {
    for (const factor of Object.keys(vec)) factors.add(factor);
  }

  // Accumulate replacement legs keyed by the canonical (sorted) counterparty pair,
  // storing risk from the lexicographically-smaller party's perspective.
  const pairs = new Map<string, { a: string; b: string; risk: Record<string, number> }>();

  for (const factor of [...factors].sort()) {
    const longs: Array<{ p: string; rem: number }> = [];
    const shorts: Array<{ p: string; rem: number }> = [];
    for (const [party, vec] of Object.entries(net)) {
      const amount = vec[factor] ?? 0;
      if (amount > EPS) longs.push({ p: party, rem: amount });
      else if (amount < -EPS) shorts.push({ p: party, rem: -amount });
    }
    const byParty = (x: { p: string }, y: { p: string }) => (x.p < y.p ? -1 : x.p > y.p ? 1 : 0);
    longs.sort(byParty);
    shorts.sort(byParty);

    let i = 0;
    let j = 0;
    while (i < longs.length && j < shorts.length) {
      const long = longs[i]!;
      const short = shorts[j]!;
      const transfer = Math.min(long.rem, short.rem);

      const [x, y] = long.p < short.p ? [long.p, short.p] : [short.p, long.p];
      const key = `${x}\u0000${y}`;
      const entry = pairs.get(key) ?? { a: x, b: y, risk: {} };
      const sign = x === long.p ? +1 : -1; // +risk means x is long the factor
      entry.risk[factor] = (entry.risk[factor] ?? 0) + sign * transfer;
      pairs.set(key, entry);

      long.rem -= transfer;
      short.rem -= transfer;
      if (long.rem <= EPS) i += 1;
      if (short.rem <= EPS) j += 1;
    }
  }

  const replacements: Replacement[] = [];
  for (const { a, b, risk } of pairs.values()) {
    const pruned = prune(risk);
    if (Object.keys(pruned).length > 0) replacements.push({ a, b, risk: pruned });
  }
  replacements.sort((r1, r2) => (`${r1.a}\u0000${r1.b}` < `${r2.a}\u0000${r2.b}` ? -1 : 1));

  return {
    teardown: trades.map((t) => t.id),
    replacements,
    netByParty: net,
  };
}
