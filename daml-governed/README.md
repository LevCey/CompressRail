# Governed cycle execution

The compression gate (`daml/CompressRail/Gate.daml`) as a governed action of a Decentralized Party, using
the `GovernableAction` interface of BitSafe's open-source
[Decentralization Manager](https://github.com/DLC-link/decentralization-manager).

The executor of the pair permits is the governance party. A member proposes `CycleExecutionProposal`; once
a threshold of members confirms, `GovernanceRules` executes it with the governance party's authority, and
the proposal runs the same package checks as the gate before executing every permit. Approval does not
replace those checks: an approved incomplete package still fails.

The tests run against the real `GovernanceRules`, with two members and a threshold of two: one
confirmation is not enough, a member cannot act as the governance party directly, approved incomplete
packages, withdrawn permits, expired packages and replays fail, and firms do not see the proposal.

What this does not show: Daml Script does not model participant hosting, so who receives which subtree is
measured on a real participant, not here. If every member of the governance party cooperates outside this
action, they can still execute a subset of approved permits, each exactly as approved.

## Build and test

```
./vendor.sh                       # fetches the governance packages at v1.12.0 and builds them
(cd ../daml && dpm build)         # compressrail
dpm build                         # compressrail-governed
(cd test && dpm test)
```

The vendored packages are built with this project's SDK, so their package ids differ from the DARs a
Decentralization Manager node distributes. A deployment must use the node's own DARs.
