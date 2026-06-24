# app — off-ledger client

The client that runs on each participant's own side. It encrypts a leg's economic
terms before anything is written on-ledger, wraps the decryption key to the leg's
counterparties only, commits to the cleartext for integrity, and (as the rest of the
client lands) verifies post-cycle risk locally and reads each party's ledger
projection.

Only ciphertext and a hash commitment ever reach the ledger; cleartext stays on the
owning party's node. This is the second of the two layers that make the operator
blind — Daml stakeholder scoping is the first; application-layer encryption is the
second, and it is not optional. On Canton the party that submits a transaction
interprets all of it, so any economic field stored in cleartext would be visible to
whoever submits. Encryption is what keeps that field unreadable even to the
submitter.

## Layout

```
crypto/        per-leg authenticated encryption, key wrapping, and commitments
  types.ts       shared types (JSON terms, key pair, recipient, sealed leg)
  sodium.ts      libsodium initialization
  canonical.ts   deterministic JSON serialization (commitment preimage)
  commitment.ts  the cleartext hash commitment
  keys.ts        X25519 key-pair generation and config encode/decode
  leg.ts         sealLeg / openLeg
  index.ts       public API
```

`verify/` (per-node residual-risk check) and `ledger/` (Ledger API access) land next.

## Encryption scheme

All primitives come from [libsodium](https://doc.libsodium.org/) via
`libsodium-wrappers`; nothing cryptographic is hand-rolled.

- **Content encryption.** Each leg gets a fresh random 256-bit content key. The
  leg's terms are authenticated-encrypted under it with `crypto_secretbox`
  (XSalsa20-Poly1305) and a random 192-bit nonce. The on-ledger ciphertext is
  `nonce ‖ box`, base64-encoded.
- **Key wrapping.** The content key is wrapped to each recipient's X25519 public key
  with a libsodium sealed box (`crypto_box_seal`). The recipients are the leg's two
  counterparties — and, only when a participant grants scoped audit disclosure, that
  participant's regulator. The operator is never a recipient, so it never holds a key
  that can open a leg.
- **Commitment.** The on-ledger commitment is
  `BLAKE2b-256(domain ‖ len(salt) ‖ salt ‖ canonical(terms))`. The salt is random
  per leg and travels inside the encrypted payload, so the commitment is hiding
  against anyone without the content key (the operator cannot recover magnitudes by
  guessing) while still binding both counterparties to the same value: from identical
  terms and salt they compute an identical commitment, which the on-ledger execute
  requires to agree on both sides.
- **On read.** A recipient unwraps the content key with its own key pair, decrypts
  and authenticates the payload, then recomputes the commitment and checks it against
  the on-ledger value. Tampering with either the ciphertext or the commitment makes
  the read fail; a non-recipient cannot unwrap the key at all.

The `ciphertext` and `commitment` outputs map directly to the on-ledger
`BilateralTrade` fields of the same names.

## Key handling

Key handling is demo-grade and labeled as such. Each party holds one X25519 key pair
loaded from per-party configuration (file or environment); keys are never hard-coded
in the source. Private keys stay on the owning node. There is no key-management
service, no HSM, and no operator-held key. Production key management is future work.

## Privacy boundary

The operator never sees a participant's cleartext economic terms — positions,
sensitivities, notionals, rates, or trade contents. It coordinates over ciphertext,
commitments, and coordination metadata only. It does see cycle topology (which pairs
receive replacement legs) and which trades are nominated; hiding that as well needs
multi-party computation and is not part of this layer. This is not zero-knowledge,
homomorphic encryption, or MPC, and it makes no claim about the legal enforceability
of any trade.

## Running

```
npm install
npm test          # vitest unit tests
npm run typecheck  # tsc --noEmit
```
