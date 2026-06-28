# CompressRail

Confidential multilateral portfolio compression for OTC derivatives, built on the Canton Network.

CompressRail lets a group of derivatives counterparties tear up offsetting bilateral trades and
atomically redistribute counterparty exposure — without any party, including the operator that runs
the cycle, ever seeing another participant's positions.

> **Status:** early development for the Encode "Build on Canton" hackathon (June–July 2026). Runs on
> Canton DevNet. The Daml model and demo are being built; see [Roadmap](#roadmap) for current status.
> Not audited. Not for production use.

## The problem

Multilateral portfolio compression reduces the gross notional and the trapped initial margin sitting in
offsetting OTC derivatives trades. It addresses a large, real cost: industry estimates put regulatory
initial margin across non-cleared and cleared derivatives in the hundreds of billions of dollars, and
the funding cost of carrying that margin runs into the billions per year.

The mechanism that delivers compression carries a structural cost of its own. To find the offsetting
cycle, every participant has to share its portfolio sensitivities with a central operator that computes
the result — and that operator therefore sees every participant's book. The largest dealers tolerate
this; much of the mid-tier sell-side and most of the buy-side do not, and stay out. A large share of
compressible exposure is left stranded as a result.

This is a privacy problem, not a technology problem.

## What CompressRail does

CompressRail moves the trust boundary from the operator to the protocol. The operator coordinates a
compression cycle but is architecturally unable to see any participant's economic terms. Each
participant verifies, on its own node, that its post-cycle risk stays within its declared tolerance, and
authorizes only its own legs. The whole multilateral rebalance commits atomically — every leg or none.
A participant can grant its home regulator a read-only view scoped to that participant's contracts alone.

## What "operator-blind" means here — precisely

Privacy claims in this space are easy to overstate, so here is the exact boundary.

The operator never sees any participant's economic terms — positions, sensitivities, notionals, or trade
details. Two mechanisms enforce this together:

1. **Daml stakeholder scoping.** The operator is never a signatory or observer on any contract that
   carries a participant's trade. Canton's projection rules then ensure the operator's node is not even
   notified of those contracts.
2. **Application-layer encryption.** Every economic field is written on-ledger only as
   authenticated-encryption ciphertext plus a hash commitment, and the operator holds no decryption key.
   This second layer is necessary, not redundant: on Canton, the participant that submits a transaction
   interprets all of it, so anything stored in cleartext would be visible to whoever submits.

**What the operator can see:** that a cycle exists, which trades are nominated (by opaque reference), the
netting topology (which participant pairs receive replacement trades), the opaque commitments, and each
participant's boolean "within tolerance" attestation. It sees no economic magnitudes.

**What this is not.** The operator does see cycle topology; hiding that as well requires multi-party
computation and is on the roadmap, not in this build. CompressRail is not zero-knowledge, not fully
homomorphic encryption, and not MPC. It does not make replacement trades legally enforceable — that is a
question of the parties' agreements, not of the protocol. It never takes custody of any asset; it
produces compression instructions and records.

## Why Canton

The problem needs three properties at the same time, which Canton provides natively:

- **Sub-transaction privacy** — a party sees only the contracts it is a stakeholder of.
- **Atomic multi-party composition** — one transaction can archive many bilateral trades and create
  their replacements across many counterparties, all-or-nothing.
- **Selective disclosure** — a regulator can be added as a scoped observer without seeing the rest of
  the graph.

A public chain would expose positions, or hide them behind heavyweight cryptography with no native
settlement. A centralized service would reintroduce the trusted operator that is the whole problem.

## How it works

The lifecycle of one compression cycle:

1. Each participant holds its bilateral trades on-ledger as encrypted payloads with hash commitments.
   Cleartext never leaves the participant's own node.
2. The operator opens a cycle: a proposal carrying a cycle id, the nominated trades by reference, the
   netting topology, and a deadline. It carries no economic terms.
3. Each participant, on its own node, decrypts its own legs, computes its post-cycle risk delta against
   its tolerance, and — only if it passes — publishes a participation contract: its commitments to the
   legs it will tear up and the replacements it will sign, plus a boolean attestation. This computation
   runs participant-side, never operator-side.
4. A single atomic transaction gathers every participant's authorization, checks that each replacement
   leg's two counterparties committed to the same terms, archives the nominated trades, and creates the
   replacement trades — each signed by its two counterparties only. If any participant is missing, any
   attestation is false, or any pair of commitments disagrees, the entire cycle aborts and nothing
   changes.
5. Optionally, a participant grants its regulator a scoped, read-only view of its own contracts.

### The privacy matrix

| Can see… | Participant A | Participant B | Operator | Regulator (A's) |
|---|---|---|---|---|
| A's economic terms | yes | no | no | yes (scoped) |
| B's economic terms | no | yes | no | no |
| Full cycle plan in cleartext | own legs only | own legs only | no | no |
| Cycle topology and validity | own legs | own legs | yes (no economics) | no |
| Margin released (own) | yes | yes | no | yes (scoped) |

This is enforced by Canton and verified by reading each party's own ledger view — not by filtering in
the interface.

## Repository layout

```
daml/      Daml model: participant profiles, bilateral trades, cycle proposal and
           participation, the atomic execute, and selective disclosure
app/       Off-ledger client: payload encryption, commitments, per-node verification,
           and Ledger API access
demo/      Demo application (demo.compressrail.com): party selection and the
           per-party views, each rendered from that party's own ledger projection
landing/   Landing site (compressrail.com)
docs/      Public documentation (docs.compressrail.com)
deploy/    Multi-node Canton DevNet topology and party allocation (config-driven)
```

## Getting started

Prerequisites:

- Daml SDK 3.x (the pinned version is recorded in `daml/daml.yaml`)
- Access to a local Canton network / DevNet

Build the model:

```
cd daml
daml build
```

The demo runs a compression cycle across separate participant nodes and lets you inspect each party's
view — including the operator's, which contains only ciphertext. Node configuration for the operator,
participants, and regulator lives in `deploy/`. Detailed run instructions are added as the components
land; see [Roadmap](#roadmap).

## Demo

You choose a party to act as — a participant, the operator, or a regulator — and get that party's own
terminal view, rendered from its own ledger projection. The demo is designed to make the privacy claim
legible and falsifiable:

- Three views side by side, from the same ledger at the same instant: a participant (its book in
  cleartext), the operator (the same contracts, with every economic field shown as the real on-ledger
  ciphertext), and a regulator (one participant's book only).
- A control that lets you act as the operator and try to reveal a participant's positions — and watch it
  fail, because there is no cleartext on the ledger to return.
- A live count of margin released alongside the number of books the operator saw: zero.

## Scope and non-goals

This is a hackathon MVP focused on the privacy architecture, not a production compression engine.

- The matching is a small, real, deterministic algorithm over a fixture scenario. Production risk models
  (SIMM, SA-CCR, CRIF) are out of scope.
- Operator-blind matching via multi-party computation, topology hiding, legal-enforceability wrappers,
  asset settlement and custody, and MainNet deployment are roadmap items, not part of this build.
- Key handling is demo-grade. The code is unaudited and runs on DevNet only.

## Roadmap

- Operator-blind matching via per-node multi-party computation, which also removes the operator's
  visibility of cycle topology.
- Replacement trades modeled against the parties' existing master agreements.
- Settlement integration for the cash leg.
- MainNet deployment.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
