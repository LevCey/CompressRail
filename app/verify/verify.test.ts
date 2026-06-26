import { describe, it, expect } from "vitest";
import {
  netRisk,
  subtractRisk,
  l1Norm,
  riskOf,
  assessCompression,
  type Position,
} from "./index";
import { sealLeg, openLeg, generateKeyPair } from "../crypto/index";

// Participant A's node-local view of an offsetting ring it can compress: two legs
// whose risk cancels, so A is risk-flat across the ring before the cycle.
const before: Position[] = [
  { legId: "AB", risk: { "2Y": 100, "5Y": 50 } },
  { legId: "CA", risk: { "2Y": -100, "5Y": -50 } },
];

describe("risk arithmetic", () => {
  it("nets sensitivities across legs and factors", () => {
    expect(netRisk(before)).toEqual({ "2Y": 0, "5Y": 0 });
  });

  it("subtracts over the union of factors", () => {
    expect(subtractRisk({ "2Y": 30, "10Y": 5 }, { "2Y": 10 })).toEqual({ "2Y": 20, "10Y": 5 });
  });

  it("takes the L1 norm", () => {
    expect(l1Norm({ "2Y": 30, "5Y": -12 })).toBe(42);
  });
});

describe("assessCompression", () => {
  it("attests true for a risk-neutral compression, even at zero tolerance", () => {
    const after: Position[] = [{ legId: "AB'", risk: { "2Y": 0, "5Y": 0 } }];
    const result = assessCompression({ before, after, tolerance: 0 });
    expect(result.magnitude).toBe(0);
    expect(result.withinTolerance).toBe(true);
  });

  it("attests true when net-risk movement stays within tolerance", () => {
    const after: Position[] = [{ legId: "AB'", risk: { "2Y": 3, "5Y": -2 } }];
    const result = assessCompression({ before, after, tolerance: 10 });
    expect(result.magnitude).toBe(5);
    expect(result.withinTolerance).toBe(true);
  });

  it("declines when net-risk movement exceeds tolerance (R4.4 / I-5)", () => {
    const after: Position[] = [{ legId: "AB'", risk: { "2Y": 30, "5Y": 0 } }];
    const result = assessCompression({ before, after, tolerance: 10 });
    expect(result.residual).toEqual({ "2Y": 30, "5Y": 0 });
    expect(result.magnitude).toBe(30);
    expect(result.withinTolerance).toBe(false);
  });

  it("is a real computation, not a constant: the same movement flips with tolerance", () => {
    const after: Position[] = [{ legId: "AB'", risk: { "2Y": 30, "5Y": 0 } }];
    expect(assessCompression({ before, after, tolerance: 10 }).withinTolerance).toBe(false);
    expect(assessCompression({ before, after, tolerance: 50 }).withinTolerance).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const after: Position[] = [{ legId: "AB'", risk: { "2Y": 7 } }];
    expect(assessCompression({ before, after, tolerance: 10 })).toEqual(
      assessCompression({ before, after, tolerance: 10 }),
    );
  });

  it("rejects an invalid tolerance", () => {
    const after: Position[] = [{ legId: "AB'", risk: { "2Y": 0 } }];
    expect(() => assessCompression({ before, after, tolerance: -1 })).toThrow(/tolerance/);
    expect(() => assessCompression({ before, after, tolerance: Number.NaN })).toThrow(/tolerance/);
  });
});

describe("riskOf", () => {
  it("extracts validated sensitivities from cleartext terms", () => {
    expect(riskOf({ instrument: "IRS", risk: { "2Y": 12.5, "5Y": -3 } })).toEqual({ "2Y": 12.5, "5Y": -3 });
  });

  it("rejects malformed terms", () => {
    expect(() => riskOf(null)).toThrow(/object/);
    expect(() => riskOf({ instrument: "IRS" })).toThrow(/risk/);
    expect(() => riskOf({ risk: { "2Y": Number.POSITIVE_INFINITY } })).toThrow(/finite/);
  });
});

describe("end-to-end: decrypt then assess", () => {
  it("runs the per-node check over the leg's decrypted cleartext", async () => {
    const alice = await generateKeyPair();
    const terms = { instrument: "IRS", notional: 100_000_000, risk: { "2Y": 0, "5Y": 0 } };
    const sealed = await sealLeg(terms, [{ party: "Alice", publicKey: alice.publicKey }]);

    const opened = await openLeg(sealed, "Alice", alice);
    const after: Position[] = [{ legId: "AB'", risk: riskOf(opened) }];

    const result = assessCompression({ before, after, tolerance: 0 });
    expect(result.withinTolerance).toBe(true);
  });
});
