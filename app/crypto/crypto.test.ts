import { describe, it, expect, beforeAll } from "vitest";
import {
  ready,
  canonicalize,
  commit,
  generateKeyPair,
  exportKeyPair,
  importKeyPair,
  sealLeg,
  openLeg,
  type JsonValue,
  type KeyPair,
  type SealedLeg,
} from "./index";

// A representative replacement-leg cleartext: the economic terms that must never
// reach the ledger or the operator.
const terms: JsonValue = {
  instrument: "IRS",
  notional: 100_000_000,
  fixedRate: 0.0325,
  currency: "USD",
  maturity: "2031-06-24",
  legs: [{ pay: "fixed" }, { receive: "float" }],
};

let alice: KeyPair;
let bob: KeyPair;
let regulator: KeyPair;
let operator: KeyPair;

beforeAll(async () => {
  await ready();
  [alice, bob, regulator, operator] = await Promise.all([
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
  ]);
});

function flipLastBase64(value: string): string {
  const buf = Buffer.from(value, "base64");
  const idx = buf.length - 1;
  buf[idx] = (buf[idx] ?? 0) ^ 0xff;
  return buf.toString("base64");
}

function flipLastHex(value: string): string {
  const last = value.slice(-1);
  return value.slice(0, -1) + (last === "0" ? "1" : "0");
}

describe("canonicalize", () => {
  it("is independent of object key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order and serializes nested structures deterministically", () => {
    expect(canonicalize({ z: [3, 2, 1], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":[3,2,1]}',
    );
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });
});

describe("commit", () => {
  it("is deterministic for identical terms and salt", async () => {
    const salt = new Uint8Array(16).fill(7);
    expect(await commit(terms, salt)).toBe(await commit(terms, salt));
  });

  it("ignores object key order in the terms", async () => {
    const salt = new Uint8Array(16).fill(7);
    const reordered: JsonValue = {
      legs: [{ pay: "fixed" }, { receive: "float" }],
      maturity: "2031-06-24",
      currency: "USD",
      fixedRate: 0.0325,
      notional: 100_000_000,
      instrument: "IRS",
    };
    expect(await commit(reordered, salt)).toBe(await commit(terms, salt));
  });

  it("changes with the salt (hiding)", async () => {
    const a = await commit(terms, new Uint8Array(16).fill(1));
    const b = await commit(terms, new Uint8Array(16).fill(2));
    expect(a).not.toBe(b);
  });
});

describe("sealLeg / openLeg", () => {
  it("round-trips for both counterparties", async () => {
    const sealed = await sealLeg(terms, [
      { party: "Alice", publicKey: alice.publicKey },
      { party: "Bob", publicKey: bob.publicKey },
    ]);

    expect(await openLeg(sealed, "Alice", alice)).toEqual(terms);
    expect(await openLeg(sealed, "Bob", bob)).toEqual(terms);
  });

  it("lets a scoped regulator recipient decrypt (R6 disclosure path)", async () => {
    const sealed = await sealLeg(terms, [
      { party: "Alice", publicKey: alice.publicKey },
      { party: "Bob", publicKey: bob.publicKey },
      { party: "RegulatorA", publicKey: regulator.publicKey },
    ]);
    expect(await openLeg(sealed, "RegulatorA", regulator)).toEqual(terms);
  });

  it("survives a config round-trip of the recipient key pair", async () => {
    const sealed = await sealLeg(terms, [{ party: "Alice", publicKey: alice.publicKey }]);
    const restored = await importKeyPair(await exportKeyPair(alice));
    expect(await openLeg(sealed, "Alice", restored)).toEqual(terms);
  });

  it("rejects duplicate recipients", async () => {
    await expect(
      sealLeg(terms, [
        { party: "Alice", publicKey: alice.publicKey },
        { party: "Alice", publicKey: alice.publicKey },
      ]),
    ).rejects.toThrow(/duplicate recipient/);
  });
});

describe("operator-blindness (R5.3 / R7 acceptance)", () => {
  let sealed: SealedLeg;

  beforeAll(async () => {
    sealed = await sealLeg(terms, [
      { party: "Alice", publicKey: alice.publicKey },
      { party: "Bob", publicKey: bob.publicKey },
    ]);
  });

  it("does not wrap the content key to the operator", () => {
    expect(Object.keys(sealed.wrappedKeys).sort()).toEqual(["Alice", "Bob"]);
    expect(sealed.wrappedKeys).not.toHaveProperty("Operator");
  });

  it("refuses to open for a non-recipient operator", async () => {
    await expect(openLeg(sealed, "Operator", operator)).rejects.toThrow(/no wrapped content key/);
  });

  it("cannot recover cleartext even given every wrapped key (only the operator's own key)", async () => {
    // The operator holds the full ledger view: ciphertext, commitment, and every
    // wrapped content key. With only its own key pair it can unwrap none of them.
    for (const party of Object.keys(sealed.wrappedKeys)) {
      await expect(openLeg(sealed, party, operator)).rejects.toThrow(/not a recipient/);
    }
  });
});

describe("tamper detection (R7 acceptance)", () => {
  let sealed: SealedLeg;

  beforeAll(async () => {
    sealed = await sealLeg(terms, [{ party: "Alice", publicKey: alice.publicKey }]);
  });

  it("detects a tampered ciphertext", async () => {
    const tampered: SealedLeg = { ...sealed, ciphertext: flipLastBase64(sealed.ciphertext) };
    await expect(openLeg(tampered, "Alice", alice)).rejects.toThrow(/authentication failed/);
  });

  it("detects a tampered commitment", async () => {
    const tampered: SealedLeg = { ...sealed, commitment: flipLastHex(sealed.commitment) };
    await expect(openLeg(tampered, "Alice", alice)).rejects.toThrow(/commitment mismatch/);
  });
});
