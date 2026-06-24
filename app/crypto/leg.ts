// Per-leg authenticated encryption with content-key wrapping.
//
// sealLeg: generate a fresh per-leg content key, authenticated-encrypt the leg's
// terms under it (XSalsa20-Poly1305), wrap the content key to each recipient's
// public key (libsodium sealed boxes), and commit to the cleartext. Only the
// ciphertext and commitment go on-ledger.
//
// openLeg: a recipient unwraps the content key with its own key pair, decrypts and
// authenticates the payload, then recomputes the commitment and checks it matches
// the on-ledger value. Any tampering — with the ciphertext or the commitment — and
// any attempt by a non-recipient (e.g. the operator) to open the leg fails.
import { commit } from "./commitment";
import { concatBytes } from "./bytes";
import { ready } from "./sodium";
import type { JsonValue, KeyPair, Recipient, SealedLeg } from "./types";

const SALT_BYTES = 16;
const PACKAGE_VERSION = 1;

interface LegPackage {
  readonly v: number;
  readonly terms: JsonValue;
  readonly salt: string; // base64
}

export async function sealLeg(terms: JsonValue, recipients: readonly Recipient[]): Promise<SealedLeg> {
  const sodium = await ready();
  if (recipients.length === 0) {
    throw new Error("sealLeg requires at least one recipient");
  }
  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (seen.has(recipient.party)) {
      throw new Error(`duplicate recipient party: ${recipient.party}`);
    }
    seen.add(recipient.party);
  }

  const contentKey = sodium.crypto_secretbox_keygen();
  const salt = sodium.randombytes_buf(SALT_BYTES);
  const commitment = await commit(terms, salt);

  const payload: LegPackage = {
    v: PACKAGE_VERSION,
    terms,
    salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
  };
  const message = sodium.from_string(JSON.stringify(payload));
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const box = sodium.crypto_secretbox_easy(message, nonce, contentKey);
  const ciphertext = sodium.to_base64(concatBytes(nonce, box), sodium.base64_variants.ORIGINAL);

  const wrappedKeys: Record<string, string> = {};
  for (const recipient of recipients) {
    const sealedKey = sodium.crypto_box_seal(contentKey, recipient.publicKey);
    wrappedKeys[recipient.party] = sodium.to_base64(sealedKey, sodium.base64_variants.ORIGINAL);
  }

  return { ciphertext, commitment, wrappedKeys };
}

export async function openLeg(sealed: SealedLeg, party: string, keyPair: KeyPair): Promise<JsonValue> {
  const sodium = await ready();

  const wrapped = sealed.wrappedKeys[party];
  if (wrapped === undefined) {
    throw new Error(`no wrapped content key for party: ${party}`);
  }

  let contentKey: Uint8Array;
  try {
    contentKey = sodium.crypto_box_seal_open(
      sodium.from_base64(wrapped, sodium.base64_variants.ORIGINAL),
      keyPair.publicKey,
      keyPair.privateKey,
    );
  } catch {
    throw new Error("failed to unwrap content key: not a recipient of this leg");
  }

  const blob = sodium.from_base64(sealed.ciphertext, sodium.base64_variants.ORIGINAL);
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
  if (blob.length <= nonceBytes) {
    throw new Error("malformed ciphertext");
  }
  const nonce = blob.subarray(0, nonceBytes);
  const box = blob.subarray(nonceBytes);

  let messageBytes: Uint8Array;
  try {
    messageBytes = sodium.crypto_secretbox_open_easy(box, nonce, contentKey);
  } catch {
    throw new Error("ciphertext authentication failed: payload was tampered with");
  }

  const payload = JSON.parse(sodium.to_string(messageBytes)) as LegPackage;
  if (payload.v !== PACKAGE_VERSION) {
    throw new Error(`unsupported leg package version: ${String(payload.v)}`);
  }

  const salt = sodium.from_base64(payload.salt, sodium.base64_variants.ORIGINAL);
  const recomputed = await commit(payload.terms, salt);
  if (recomputed !== sealed.commitment) {
    throw new Error("commitment mismatch: on-ledger commitment does not match the decrypted terms");
  }

  return payload.terms;
}
