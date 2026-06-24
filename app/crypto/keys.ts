// Per-party key material for content-key wrapping.
//
// Each party holds one X25519 key pair. Public keys are shared so counterparties can
// wrap content keys to one another; private keys are loaded from per-party
// configuration (demo-grade: file/env, never hard-coded — see the package README)
// and never leave the owning node. The operator holds no key pair that is ever a
// recipient of a position-bearing leg.
import { ready } from "./sodium";
import type { KeyPair } from "./types";

export interface EncodedKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const sodium = await ready();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function exportPublicKey(publicKey: Uint8Array): Promise<string> {
  const sodium = await ready();
  return sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL);
}

export async function importPublicKey(encoded: string): Promise<Uint8Array> {
  const sodium = await ready();
  return sodium.from_base64(encoded, sodium.base64_variants.ORIGINAL);
}

export async function exportKeyPair(keyPair: KeyPair): Promise<EncodedKeyPair> {
  const sodium = await ready();
  return {
    publicKey: sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(keyPair.privateKey, sodium.base64_variants.ORIGINAL),
  };
}

export async function importKeyPair(encoded: EncodedKeyPair): Promise<KeyPair> {
  const sodium = await ready();
  return {
    publicKey: sodium.from_base64(encoded.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.from_base64(encoded.privateKey, sodium.base64_variants.ORIGINAL),
  };
}
