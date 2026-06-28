import { describe, it, expect } from "vitest";
import { netPositions, match, type Trade, type Replacement } from "./index";

function replacementsAsTrades(reps: readonly Replacement[]): Trade[] {
  return reps.map((r, k) => ({ id: `R${k}`, a: r.a, b: r.b, risk: r.risk }));
}

// The defining invariant of compression: the match must preserve every party's net
// risk, per factor, while collapsing the gross set of trades.
function expectNetPreserved(trades: readonly Trade[], reps: readonly Replacement[]): void {
  const before = netPositions(trades);
  const after = netPositions(replacementsAsTrades(reps));
  const parties = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const p of parties) {
    const factors = new Set([...Object.keys(before[p] ?? {}), ...Object.keys(after[p] ?? {})]);
    for (const f of factors) {
      const diff = Math.abs((before[p]?.[f] ?? 0) - (after[p]?.[f] ?? 0));
      expect(diff).toBeLessThan(1e-9);
    }
  }
}

describe("netPositions", () => {
  it("nets a party's trades, with the two sides on opposite signs", () => {
    const trades: Trade[] = [
      { id: "AB", a: "A", b: "B", risk: { "2Y": 100 } },
      { id: "CA", a: "C", b: "A", risk: { "2Y": 100 } },
    ];
    const net = netPositions(trades);
    // A is long 100 (AB) and short 100 (CA) -> flat; pruned to {}
    expect(net["A"]).toEqual({});
    expect(net["B"]).toEqual({ "2Y": -100 });
    expect(net["C"]).toEqual({ "2Y": 100 });
  });
});

describe("match", () => {
  it("fully compresses a perfectly offsetting ring to zero replacement legs", () => {
    const trades: Trade[] = [
      { id: "AB", a: "A", b: "B", risk: { "2Y": 100 } },
      { id: "BC", a: "B", b: "C", risk: { "2Y": 100 } },
      { id: "CA", a: "C", b: "A", risk: { "2Y": 100 } },
    ];
    const result = match(trades);
    expect(result.replacements).toEqual([]);
    expect(result.teardown.sort()).toEqual(["AB", "BC", "CA"]);
    expectNetPreserved(trades, result.replacements);
  });

  it("collapses a chain into a single net-preserving leg, dropping the flat party", () => {
    const trades: Trade[] = [
      { id: "AB", a: "A", b: "B", risk: { "2Y": 100 } },
      { id: "BC", a: "B", b: "C", risk: { "2Y": 100 } },
    ];
    const result = match(trades);
    expect(result.replacements).toEqual([{ a: "A", b: "C", risk: { "2Y": 100 } }]);
    expect(result.teardown).toEqual(["AB", "BC"]);
    expect(result.netByParty["B"]).toEqual({}); // B nets out and holds nothing
    expectNetPreserved(trades, result.replacements);
  });

  it("preserves net risk across multiple factors", () => {
    const trades: Trade[] = [
      { id: "AB", a: "A", b: "B", risk: { "2Y": 100, "5Y": 20 } },
      { id: "BC", a: "B", b: "C", risk: { "2Y": 100, "5Y": -30 } },
    ];
    const result = match(trades);
    expect(result.replacements.length).toBeGreaterThan(0);
    expectNetPreserved(trades, result.replacements);
  });

  it("tears up the entire nominated set", () => {
    const trades: Trade[] = [
      { id: "t1", a: "A", b: "B", risk: { "2Y": 40 } },
      { id: "t2", a: "B", b: "C", risk: { "2Y": 70 } },
      { id: "t3", a: "C", b: "A", risk: { "2Y": 25 } },
    ];
    expect(match(trades).teardown).toEqual(["t1", "t2", "t3"]);
  });

  it("is deterministic", () => {
    const trades: Trade[] = [
      { id: "AB", a: "A", b: "B", risk: { "2Y": 100, "10Y": 40 } },
      { id: "BC", a: "B", b: "C", risk: { "2Y": 60 } },
      { id: "CA", a: "C", b: "A", risk: { "10Y": 40 } },
    ];
    expect(match(trades)).toEqual(match(trades));
  });
});
