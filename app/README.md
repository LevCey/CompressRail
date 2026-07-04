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

verify/        per-node residual-risk check (the stubbed solver)
  types.ts       risk vector, position, assessment
  risk.ts        net-risk arithmetic and the L1 magnitude
  terms.ts       read risk sensitivities from a decrypted leg's cleartext
  verify.ts      assessCompression -> the within-tolerance attestation
  index.ts       public API

cycle/         participant-side cycle orchestration
  types.ts       held leg, participation submission, result
  participation.ts  prepareParticipation: verify locally, then build the submission
  index.ts       public API

solver/        cycle-matching stand-in (deterministic, over fixture cleartext)
  types.ts       trade, replacement, match result
  risk.ts        risk-vector accumulation helpers
  match.ts       netPositions + match: net-preserving compression
  index.ts       public API

ledger/        JSON Ledger API v2 client (per-party, config-driven)
  types.ts       request/response shapes
  transport.ts   injectable HTTP transport (fetch-based default)
  requests.ts    command + active-contracts request builders
  parse.ts       response parsing and errors
  client.ts      LedgerClient: submit, exercise, per-party reads
  index.ts       public API

model/         typed bindings to the on-ledger Daml model
  types.ts       record shapes (trades, cycle, participation, disclosure)
  templates.ts   template ids + choice names
  encode.ts      create/choice argument encoders (Daml-LF JSON)
  decode.ts      active-contract decoders
  index.ts       public API
```

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

## Per-node verification

`verify/` is the participant-side residual-risk check that gates a commitment. Each
participant decrypts its own legs, reads their risk sensitivities, and computes how
far the proposed compression would move its net risk — the L1 magnitude of the
difference between its post-cycle and pre-cycle net risk. If that movement is within
the participant's declared tolerance it attests `true`; otherwise it declines, and a
decline makes the whole cycle fail to commit. Only the boolean attestation goes
on-ledger; the magnitude and the tolerance stay on the node.

This is a real, inspectable computation over node-local cleartext — never a
hard-coded result — standing in for a production risk model (SIMM, SA-CCR, CRIF),
which is out of scope. It runs only on the participant's side, never operator-side.

## Cycle participation

`cycle/` composes the encryption and the per-node check into what a participant
actually submits. `prepareParticipation` opens — and so verifies — each replacement
leg the participant would hold, runs the residual-risk check, and only if it passes
returns the on-ledger participation: the leg commitments, the ciphertext, and a
single within-tolerance boolean. Both counterparties to a leg commit the same
commitment, which is what the on-ledger execute checks; a participant beyond its
tolerance declines instead, and the cycle cannot commit without it.

## Cycle matching

`solver/` computes which nominated trades a cycle tears up and which replacement legs
restore each party's net risk. Per risk factor it pairs the net-long parties against
the net-short ones, so the result preserves every party's net risk while collapsing
the gross web of trades — a perfectly offsetting ring compresses to zero legs. It is
a small, real, deterministic algorithm over fixture cleartext, standing in for the
per-node multi-party computation a production system would run; it is never the
operator, which only ever sees the resulting topology and commitments. Production
risk models (SIMM, SA-CCR, CRIF) are out of scope.

## Ledger access

`ledger/` is a small JSON Ledger API v2 client. It submits commands (create,
exercise) and reads a single party's active contracts and its CREATE/ARCHIVE
activity feed (`updates`), so visibility comes from Canton's projection rather than
from filtering in the client. The base URL and the per-party access token are
configuration; the transport is injectable, and the client holds no key that can
decrypt a participant's payload — it only ever moves ciphertext and commitments.
Request and response shapes follow the published JSON Ledger API reference and were
additionally verified against a live Canton sandbox.

## Model bindings

`model/` maps the on-ledger Daml model to the JSON the ledger client sends and reads:
template ids in package-name form, encoders that turn typed values into Daml-LF JSON
(records as objects, a (Party, Party) pair as `{_1, _2}`, an Optional as the value or
null), and decoders that read contracts back from the active-contract set. Only
opaque ciphertext and commitments cross this boundary; no cleartext economic term is
ever encoded onto the ledger.

## Privacy matrix

`scenario/privacy-matrix.ts` computes the same claim restated in the public
README's privacy-matrix table, from real per-party projections rather than
asserting it. Given a set of real, live-allocated party ids, it reads each party's
own `BilateralTrade` and `CompressionCycle` projections and derives every cell —
never a hardcoded "yes"/"no". A cell this module has no basis to measure (for
example, a regulator row when no regulator was allocated by the driving scenario)
renders honestly as "unknown" rather than a guessed value.

## Running

```
npm install
npm test          # vitest unit tests
npm run typecheck  # tsc --noEmit
```
