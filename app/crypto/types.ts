// Shared types for the off-ledger crypto layer.
//
// A leg's economic terms are an arbitrary JSON-shaped value. They are encrypted to
// a per-leg content key, which is wrapped to the leg's recipients (its two
// counterparties, and optionally a participant's regulator). Only ciphertext and a
// hash commitment ever go on-ledger; cleartext stays on the owning party's node.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

// An X25519 key pair identifying a party for content-key wrapping. Private keys are
// loaded from per-party configuration and never leave the owning node; no operator
// key is ever a recipient of a position-bearing leg.
export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

// A recipient the content key is wrapped to: a party identifier plus its public key.
export interface Recipient {
  readonly party: string;
  readonly publicKey: Uint8Array;
}

// The output of sealing a leg. `ciphertext` and `commitment` are the only fields
// written on-ledger (BilateralTrade.terms / .commitment). `wrappedKeys` are
// distributed off-ledger to the recipients; the operator never holds an entry.
export interface SealedLeg {
  readonly ciphertext: string; // base64: nonce || secretbox(payload)
  readonly commitment: string; // hex: BLAKE2b-256 over the canonical cleartext
  readonly wrappedKeys: Readonly<Record<string, string>>; // party -> base64 sealed content key
}
