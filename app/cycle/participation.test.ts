import { describe, it, expect, beforeAll } from "vitest";
import { prepareParticipation, type HeldLeg } from "./index";
import { sealLeg, generateKeyPair, type KeyPair, type JsonValue } from "../crypto/index";
import type { Position } from "../verify/index";

let alice: KeyPair;
let bob: KeyPair;
let carol: KeyPair;
let operator: KeyPair;

beforeAll(async () => {
  [alice, bob, carol, operator] = await Promise.all([
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
  ]);
});

// A is risk-flat across an offsetting ring before the cycle.
const before: Position[] = [
  { legId: "AB", risk: { "2Y": 100, "5Y": 50 } },
  { legId: "CA", risk: { "2Y": -100, "5Y": -50 } },
];

function sealAB(terms: JsonValue) {
  return sealLeg(terms, [
    { party: "A", publicKey: alice.publicKey },
    { party: "B", publicKey: bob.publicKey },
  ]);
}

function flipLastHex(value: string): string {
  return value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");
}

describe("prepareParticipation", () => {
  it("commits within tolerance, and both counterparties agree on the same commitment", async () => {
    const sealed = await sealAB({ instrument: "IRS", notional: 100_000_000, risk: { "2Y": 0, "5Y": 0 } });
    const a = await prepareParticipation({
      participant: "A", keyPair: alice, before, legs: [{ counterparty: "B", sealed }], tolerance: 0,
    });
    const b = await prepareParticipation({
      participant: "B", keyPair: bob, before: [], legs: [{ counterparty: "A", sealed }], tolerance: 0,
    });

    expect(a.decision).toBe("commit");
    expect(b.decision).toBe("commit");
    if (a.decision !== "commit" || b.decision !== "commit") return;
    // The two-sided agreement the on-ledger execute enforces.
    expect(a.submission.legs[0]!.commitment).toBe(b.submission.legs[0]!.commitment);
    expect(a.submission.withinTolerance).toBe(true);
  });

  it("puts only {counterparty, commitment, enc} + boolean on-ledger — no cleartext, risk, or tolerance (R4.3)", async () => {
    const sealed = await sealAB({ instrument: "IRS", notional: 100_000_000, currency: "USD", risk: { "2Y": 0, "5Y": 0 } });
    const res = await prepareParticipation({
      participant: "A", keyPair: alice, before, legs: [{ counterparty: "B", sealed }], tolerance: 0,
    });
    expect(res.decision).toBe("commit");
    if (res.decision !== "commit") return;

    expect(Object.keys(res.submission).sort()).toEqual(["legs", "participant", "withinTolerance"]);
    expect(Object.keys(res.submission.legs[0]!).sort()).toEqual(["commitment", "counterparty", "enc"]);
    // The magnitude and tolerance exist only in the node-local assessment, never in the submission.
    expect(res.assessment).toHaveProperty("tolerance");
    expect(res.submission).not.toHaveProperty("assessment");
  });

  it("declines when post-cycle risk movement exceeds tolerance (R4.4 / I-5)", async () => {
    const sealed = await sealAB({ instrument: "IRS", risk: { "2Y": 30 } });
    const res = await prepareParticipation({
      participant: "A", keyPair: alice, before, legs: [{ counterparty: "B", sealed }], tolerance: 10,
    });
    expect(res.decision).toBe("decline");
    expect(res.assessment.withinTolerance).toBe(false);
    expect(res.assessment.magnitude).toBe(30);
  });

  it("commits an empty participation when the participant nets out (matches the fixture's C)", async () => {
    const res = await prepareParticipation({
      participant: "C", keyPair: carol, before: [{ legId: "x", risk: { "2Y": 0 } }], legs: [], tolerance: 0,
    });
    expect(res.decision).toBe("commit");
    if (res.decision !== "commit") return;
    expect(res.submission.legs).toEqual([]);
    expect(res.submission.withinTolerance).toBe(true);
  });

  it("seals legs only to the counterparties — the operator is never a recipient", async () => {
    const sealed = await sealAB({ instrument: "IRS", risk: { "2Y": 0 } });
    expect(Object.keys(sealed.wrappedKeys).sort()).toEqual(["A", "B"]);
    expect(sealed.wrappedKeys).not.toHaveProperty("Operator");
    void operator;
  });

  it("refuses to commit a leg whose commitment fails verification", async () => {
    const sealed = await sealAB({ instrument: "IRS", risk: { "2Y": 0 } });
    const tampered: HeldLeg = { counterparty: "B", sealed: { ...sealed, commitment: flipLastHex(sealed.commitment) } };
    await expect(
      prepareParticipation({ participant: "A", keyPair: alice, before, legs: [tampered], tolerance: 0 }),
    ).rejects.toThrow(/commitment mismatch/);
  });
});
