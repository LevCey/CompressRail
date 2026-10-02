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
./vendor.sh                       # fetches the released governance DARs at v1.12.0, SHA-256 checked
(cd ../daml && dpm build)         # compressrail
dpm build                         # compressrail-governed
(cd test && dpm test)
```

These are the same DAR files a Decentralization Manager v1.12.0 node distributes, so the package ids
match a real deployment.

## LocalNet rehearsal (`localnet/`)

`localnet/rehearse.py` runs the governed cycle end to end on Decentralization Manager's three-node LocalNet
sandbox (`hackathon` branch), with Decentralization Manager v1.12.0 and Splice LocalNet 0.8.4. Nodes 1 and
2 host a dedicated governance party for compression (two owners, threshold 2) and one member each; node 3
hosts three firms and does not host the governance party. The script distributes these DARs through the
tool, deploys `GovernanceRules`, creates a ring of trades and pair permits on node 3, proposes on node 1,
confirms on nodes 1 and 2, executes through the tool's API, and reads each party's ledger-effects stream.
`localnet/topology.sh` reads the party's thresholds back from a participant's Admin API.

Measured on 1 October 2026 (three runs):

- The package executed atomically with two confirmations; each firm then held only its net leg, and the
  firm that nets out held nothing.
- Each firm's ledger-effects stream, from its first trade to settlement, contained events of its own two
  pairs only, and no proposal, confirmation, rules or execution-result event. The governance party's
  stream contained all three pairs and the governance events.
- Read back from both hosts: hosting confirmation threshold 2, party signing keys 2 of 2, decentralized
  namespace 2 of 2; `GovernanceRules` threshold 2.
- Rejected, with the reason recorded: execution with one confirmation (Daml, `GovernanceRules`); a member
  exercising a permit (Daml authorization); submitting as the governance party from one node (Canton:
  no participant can submit for it); replay after execution (consumed contracts).
- With one of the two hosts disconnected, execution did not complete (HTTP 503 after 20 s), and state was
  unchanged after two minutes offline and after reconnecting; the same confirmations then executed the
  package. In an earlier run the host came back within the confirmation timeout and the pending request
  completed instead.

`localnet/topology_attacks.py` then has node 1, one of the two owners, try to change the party's control
on its own (measured 2 October 2026):

- lowering the hosting confirmation threshold to 1, removing the other host, and lowering the namespace
  threshold to 1 each stayed a pending proposal signed by one key; the effective topology was unchanged;
- lowering `GovernanceRules`' threshold through a self-action with one confirmation was rejected
  (`Enough member confirmations to execute action`);
- a restarted Decentralization Manager node kept its participant id, public address and Noise key, still
  listed the party, and rejoined the mesh.

`localnet/failures.py` checks that both members' approval does not override the package checks (measured
2 October 2026): an approved package that leaves out a pair is rejected (`incomplete bundle`); a permit
withdrawn after approval makes execution fail (the permit is no longer active); a package whose deadline
passed before execution is rejected (`gate is past its deadline`). In each case every firm still held its
two original trades.

The pending proposals stay on the synchronizer: a second owner signing one would make it effective. Owners
must never co-sign a topology proposal for the party that they did not expect.

Limits: all three firms share one participant (node 3), so the measurement is per party, not per firm's
own node; the sandbox runs every participant in one Canton process on one host; both members are
operated by the same person in the rehearsal.

```
# on a host running the sandbox (hackathon/up.sh, then hackathon/seed.sh):
python3 localnet/rehearse.py <decentralization-manager-checkout> <dir-with-the-two-dars>
CR_OFFLINE=1 python3 localnet/rehearse.py ...      # also take node 2 offline before executing
localnet/topology.sh localhost:3902 <party-id> <synchronizer-id>
python3 localnet/topology_attacks.py <decentralization-manager-checkout>
python3 localnet/failures.py <decentralization-manager-checkout> <dir-with-the-two-dars>
```

