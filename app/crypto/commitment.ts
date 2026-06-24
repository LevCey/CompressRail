// The on-ledger integrity commitment over a leg's cleartext terms.
//
// commitment = BLAKE2b-256( domain || len(salt) || salt || canonical(terms) )
//
// The salt is random per leg and travels inside the encrypted payload, so the
// commitment is hiding against anyone without the content key (the operator cannot
// recover the magnitudes by guessing) while still binding the two counterparties to
// the same value: given identical terms and salt they compute an identical
// commitment, which the on-ledger execute checks must agree on both sides.
import { canonicalize } from "./canonical";
import { concatBytes } from "./bytes";
import { ready } from "./sodium";
import type { JsonValue } from "./types";

const COMMITMENT_DOMAIN = "compressrail/leg-commitment/v1";
const COMMITMENT_BYTES = 32;

export async function commit(terms: JsonValue, salt: Uint8Array): Promise<string> {
  const sodium = await ready();
  const preimage = concatBytes(
    sodium.from_string(COMMITMENT_DOMAIN),
    Uint8Array.of(salt.length),
    salt,
    sodium.from_string(canonicalize(terms)),
  );
  return sodium.to_hex(sodium.crypto_generichash(COMMITMENT_BYTES, preimage, null));
}
