import { describe, it, expect } from "vitest";
import { netPositions, match, type Trade } from "./index";

// The five-firm scenario run on LocalNet by daml-governed/localnet/multifirm.py.
// Test amounts of one risk factor; `risk` is from `a`'s side (a long, b short).
// multifirm.py uses exactly the replacements pinned here.
export const FIVE_FIRM_TRADES: Trade[] = [
  { id: "t1", a: "A", b: "B", risk: { "5Y": 100 } },
  { id: "t2", a: "B", b: "C", risk: { "5Y": 80 } },
  { id: "t3", a: "C", b: "A", risk: { "5Y": 60 } },
  { id: "t4", a: "C", b: "D", risk: { "5Y": 50 } },
  { id: "t5", a: "D", b: "B", risk: { "5Y": 30 } },
  { id: "t6", a: "D", b: "E", risk: { "5Y": 40 } },
  { id: "t7", a: "E", b: "C", risk: { "5Y": 30 } },
  { id: "t8", a: "A", b: "E", risk: { "5Y": 10 } },
];

const gross = (ts: readonly { risk: Record<string, number> }[]) =>
  ts.reduce((s, t) => s + Object.values(t.risk).reduce((x, v) => x + Math.abs(v), 0), 0);

describe("five-firm scenario", () => {
  it("compresses eight trades among five firms into two net legs", () => {
    const m = match(FIVE_FIRM_TRADES);
    expect(m.teardown).toHaveLength(8);
    expect(m.replacements).toEqual([
      { a: "A", b: "B", risk: { "5Y": 50 } },
      { a: "D", b: "E", risk: { "5Y": 20 } },
    ]);
    expect(gross(FIVE_FIRM_TRADES)).toBe(400);
    expect(gross(m.replacements)).toBe(70);
  });

  it("preserves every firm's net position, and firm C nets out", () => {
    const m = match(FIVE_FIRM_TRADES);
    const after = netPositions(m.replacements.map((r, k) => ({ id: `n${k}`, ...r })));
    expect(netPositions(FIVE_FIRM_TRADES)).toEqual({
      A: { "5Y": 50 }, B: { "5Y": -50 }, C: {}, D: { "5Y": 20 }, E: { "5Y": -20 },
    });
    for (const f of ["A", "B", "D", "E"]) expect(after[f]).toEqual(netPositions(FIVE_FIRM_TRADES)[f]);
    expect(after["C"]).toBeUndefined();
  });

  it("creates legs only between firms that already traded, in the same direction and smaller", () => {
    const m = match(FIVE_FIRM_TRADES);
    for (const r of m.replacements) {
      const orig = FIVE_FIRM_TRADES.filter((t) => (t.a === r.a && t.b === r.b) || (t.a === r.b && t.b === r.a));
      const before = orig.reduce((s, t) => s + (t.a === r.a ? t.risk["5Y"]! : -t.risk["5Y"]!), 0);
      expect(Math.sign(before)).toBe(Math.sign(r.risk["5Y"]!));
      expect(Math.abs(r.risk["5Y"]!)).toBeLessThan(Math.abs(before));
    }
  });
});
