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

## Restricting which actions the party can execute (prototype)

Decentralization Manager's `GovernanceRules` executes any template that implements `GovernableAction` for
its party. `test/.../AlternativeAction.daml` shows what that means here: a `PartialExecution` action that
exercises a single permit, with the same label as the real one, executes under the stock rules once both
members confirm, and leaves a firm partly compressed.

`CompressionRules` (`rules/daml/CompressRail/RestrictedRules.daml`) is a prototype of rules for the compression
party that admit exactly one implementation: it compares the full template identity of the fetched action,
package id included, with `CycleExecutionProposal`, at confirmation and again at execution. Under it the
alternative action cannot be confirmed, while the real cycle executes, one confirmation is not enough, and
an approved incomplete package still fails.

It lives in its own package (`rules/`, `compressrail-rules`): under smart-contract upgrading a choice runs
the code of the package version selected for the contract, so rules in the same package as the action they
admit would be upgraded together with it.

It constrains this path only: the members that control the party can still create other rules for it or
exercise a permit directly. And the tool's built-in flows look for `GovernanceRules`, so using these rules
gives those up. It is a prototype for an upstream proposal, not part of the deployment.

## Build and test

```
./vendor.sh                       # fetches the released governance DARs at v1.12.0, SHA-256 checked
(cd ../daml && dpm build)         # compressrail
dpm build                         # compressrail-governed
(cd rules && dpm build)            # compressrail-rules
(cd test && dpm test)
```

These are the same DAR files a Decentralization Manager v1.12.0 node distributes, so the package ids
match a real deployment.

## Reproduce on a clean machine

`localnet/reproduce.sh` runs the whole LocalNet evidence from a fresh clone with one command: it builds the
packages (and checks that their package ids match the ones deployed on DevNet), runs the Daml tests, starts
Decentralization Manager's sandbox at a pinned commit with the versions DevNet runs (v1.12.0, Splice LocalNet
0.8.4), runs the governed cycle with its negative tests and visibility read-back (`rehearse.py`), then the
execution-failure cases (`failures.py`), and prints how many checks passed.

Needs Linux or macOS, Docker with Compose v2.1.1+ and at least 12 GB of memory and 4 CPUs for Docker, about
20 GB of free disk, and a network connection (the first start pulls several GB of images). The Decentralization
Manager image is amd64-only: on an ARM Linux host also install amd64 emulation (on Ubuntu,
`sudo apt-get install -y qemu-user-static binfmt-support`); Docker Desktop on Apple silicon provides it. On Ubuntu:

```
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git curl jq python3 default-jdk-headless
sudo usermod -aG docker "$USER"            # then log out and back in
curl https://get.digitalasset.com/install/install.sh | sh
export PATH="$HOME/.dpm/bin:$PATH"
git clone https://github.com/LevCey/CompressRail.git && cd CompressRail
daml-governed/localnet/reproduce.sh
```

The sandbox runs with authentication off: run it on a machine whose ports other hosts cannot reach (a laptop,
or a server firewalled to SSH). Stop it with `.localnet-work/decentralization-manager/hackathon/down.sh`; to run
the script again, first wipe the sandbox with `.localnet-work/decentralization-manager/hackathon/reset.sh --yes`.

Checked on 6 October 2026 (UTC) on a fresh Ubuntu 26.04 VPS (ARM64, 8 vCPU, 16 GB), as a new non-root user
following exactly the steps above plus the emulation package: both package ids matched the DevNet deployment,
27 and 17 Daml tests passed, and all 7 ledger checks passed (one confirmation, member as executor, one node as
the party, replay, incomplete package, withdrawn permit, expired package). The visibility read-back matched
DevNet's: each firm saw only its own two pairs and no governance contracts. With the images already pulled the
run took 13 minutes; the first image pull adds several minutes. Not separately checked on a clean x86-64 machine,
where the manager image runs natively.

## DevNet run (`devnet/`)

On 6 October 2026 a compression cycle executed on Canton DevNet through a Decentralized Party that
CompressRail and BitSafe control together. Identifiers and measurements: `devnet/results-2026-10-06.json`.

Setup:

- The execution party `compressrail-exec` was created with Decentralization Manager (v1.12.0 on our node,
  v1.13.0 on BitSafe's). It has two owners, one per organisation, and is hosted with confirmation permission
  on our operator participant (`compressrail-operator-1`) and on BitSafe's `iBTC-validator-1`. Read back from
  our host before and after the run: hosting confirmation threshold 2, party signing keys 2 of 2,
  decentralized namespace 2 of 2, no pending proposals. BitSafe's owner key was compared out of band with the
  topology. These are separate controls: executing the cycle used the members' confirmations under
  `GovernanceRules` and both hosts' transaction confirmations; it did not collect new signatures with the
  party's signing keys.
- `GovernanceRules` (governance-core-v1, `361d1f28…`), deployed through the tool and accepted by BitSafe:
  members `compressrail-member` (on our operator participant) and `attestor-1` (hosted only on BitSafe's
  node), threshold 2, confirmation timeout 24 hours.
- The tool distributed `compressrail` 0.0.3 and `compressrail-governed` 0.0.1 to BitSafe's node; both, and
  governance-core-v1, are vetted there.
- Firms A and C are on our DevNet validator, firm B on the NODERS-hosted HackCanton participant. Three trades
  form the A–B, C–B, C–A ring; trades and pair permits are agreed by propose/accept, and every permit names
  the execution party as its only executor.

Run (`devnet/cycle.py` on our operator host; `devnet/firm_b.py` with firm B's own credentials):

1. `compressrail-member` proposed the `CycleExecutionProposal` for the three permits.
2. `compressrail-member` confirmed. Then each of these was rejected and nothing changed: execution with that
   one confirmation (`DAML_FAILURE`, `Enough confirmations to execute action`); our member exercising a permit
   directly (`DAML_AUTHORIZATION_ERROR`); our node submitting as the execution party
   (`NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT`).
3. `attestor-1` confirmed, from BitSafe's node.
4. `compressrail-member` executed with both confirmations, in one transaction (update `1220b29b83daaaea…`,
   17:00 UTC). The `GovernanceExecutionResult` lists both confirmers. Of this run's trades, firms A and B then
   held only the net A–B leg and firm C none; the three permits were consumed and the proposal was archived.

What each party received, from its ledger-effects stream since the start of the run, read with that party's
own rights:

| Party | Pairs | Governance contracts |
|---|---|---|
| firm A (our validator) | A–B, C–A | none |
| firm C (our validator) | C–A, C–B | none |
| firm B (HackCanton participant) | A–B, C–B | none |
| `compressrail-exec`, read on our host | all three | proposal, confirmations, rules, execution result |

Both hosts are trusted with the execution party's view by design; we did not independently query BitSafe's
copy for this measurement. The HackCanton participant
had only `compressrail` vetted, and the execution did not need the governance packages there.

Where this differs from the tool's standard flow:

- On our node the manager's `/governance/confirm` failed with `INVALID_TOKEN … missing a user-id`: in test mode
  the manager sends no user id, and our operator participant runs with Ledger API authentication disabled,
  so the participant cannot take one from a token. Our confirmation and execution therefore exercise
  `GovernanceRules_ConfirmAction` and `GovernanceRules_ExecuteConfirmedAction` directly, as our member with an
  explicit `userId`. The checks are the same: they are in `GovernanceRules`. An explicit `userId` satisfies the
  Ledger API's submission requirement; it does not authenticate the caller. So this is an application
  integration with the manager's deployed governance contracts and a direct Ledger API workaround on our side;
  our side did not run through the manager's confirm and execute endpoints.
- In test mode the manager's Approvals page lists governance actions only for authenticated parties, so on our
  node the proposal and confirmations show in the party's audit trail instead.

Limits:

- Hosting is 2 of 2: both hosts are required for execution. The outage behaviour was measured on LocalNet
  (below), not on DevNet; we make no availability claim.
- Stock `GovernanceRules` execute any `GovernableAction` the members approve. We restrict that by policy:
  members confirm only `CycleExecutionProposal` from `compressrail-governed` `d7ea0996…`, no `BatchGate` is
  created for the execution party, and no package successor is uploaded while permits, proposals or
  confirmations are outstanding. `CompressionRules` (above) is not deployed.
- Our manager runs in insecure mode, which the tool permits on DevNet only, and our operator participant's
  Ledger API has authentication disabled. The manager's API and the operator participant's Ledger and Admin
  APIs are reachable only on our host (checked from outside on 6 October 2026: of their ports, only the
  manager's peer port 9000 is open). This is not a production authentication setup.
- Firms A and C share our hosted-demo validator, whose JSON Ledger API is public for the demo; firm B is on a
  colocated HackCanton participant; our two validators run on one host. So this is not each firm on its own
  infrastructure. The firms' bundle salts are generated in one
  test process. Trade terms are opaque placeholders, and the ring is set up by the script: this run does not
  exercise the matcher.

To run it against another Decentralized Party (configuration: the `CR_*` variables in each script's header;
the defaults are the deployment above):

```
# on the host of the participant that hosts the execution party and your member
python3 devnet/cycle.py setup             # firms A and C, trade C–A, trade proposals to firm B
python3 devnet/firm_b.py accept-trades    # on firm B's participant, with firm B's CR_FIRM_* settings
python3 devnet/cycle.py permits
python3 devnet/firm_b.py accept-permits
python3 devnet/cycle.py propose           # runs the read-only `check` first
python3 devnet/cycle.py confirm           # your member's confirmation, then the three rejections
python3 devnet/cycle.py status            # after the other member confirms on its node
python3 devnet/cycle.py execute
python3 devnet/cycle.py evidence && python3 devnet/firm_b.py evidence
```

Prerequisites: `GovernanceRules` deployed for the party with both members; the three DARs vetted on every host
of the party, and `compressrail` on the firms' participants; your ledger API user with act-as and read-as on
the party and on your member.

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

`localnet/upgrades.py` exercises upgrades, with rehearsal-only successors built by
`localnet/build_upgrades.sh` (measured 2 October 2026):

- **Action upgrade, stock rules.** A cycle approved under `compressrail-governed` 0.0.1 was executed after
  a successor whose `executeImpl` runs only the first permit had been uploaded to both hosts of the party.
  With no package preference, execution ran the successor and left firm A partly compressed. Uploading a
  DAR vets it, and the highest vetted version is selected by default.
- **Action upgrade, restricted rules.** The same sequence under `CompressionRules` was rejected
  (`Action implementation not admitted`), with the successor selected by default and explicitly; with
  0.0.1 selected the full package executed.
- **Permit upgrade.** Selecting a successor of `compressrail` whose `Permit_Execute` drops the net leg did
  not change the permit code the cycle reached: the action calls the package checks as a function, linked
  to the `compressrail` version it was compiled against. With an action successor linked to the permit
  successor, both vetted on the party's hosts only, execution was refused at package selection
  (`UNRESOLVED_PACKAGE_NAME`) and nothing changed; after the firms' node vetted the permit successor, the
  same execution ran it. The firms' vetting decided the outcome.
- Both hosts of the party received the same events.

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
localnet/build_upgrades.sh /tmp/cr-upgrades       # rehearsal-only successors
python3 localnet/upgrades.py <decentralization-manager-checkout> <dir-with-the-dars> /tmp/cr-upgrades
```

