#!/usr/bin/env python3
"""Execution failures of the governed cycle, on the LocalNet sandbox.

Run after rehearse.py (it reuses the governance party E, its GovernanceRules and
the helpers there). Each case builds a fresh ring on node 3, gets both members'
confirmations, and then tries to execute; each must be rejected for the stated
reason and leave every firm holding exactly its two original trades:

  - incomplete: both members approve a package that leaves out one pair;
  - withdrawn:  a firm withdraws its permit after both members approved;
  - expired:    the package deadline passes before execution.

Confirmations and executions are submitted through the Ledger API as the
members, which is what the tool does underneath; it lets the test read the
exact rejection reason.

Usage: failures.py <decentralization-manager-checkout> <dir-with-dars>
"""
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import rehearse as r

T_CONF = "#governance-core-v1:Governance.Confirmation:GovernanceConfirmation"


def ring(e, run, deadline):
    """Three firms on node 3, a ring A–B, B–C, C–A, and three pair permits for E."""
    firms = {}
    for f in "ABC":
        firms[f] = r.lapi(3, "/v2/parties", {"partyIdHint": f"crf-{f.lower()}-{run}", "identityProviderId": ""})[
            "partyDetails"]["party"]
        r.lapi(3, f"/v2/users/{r.USER}/rights", {"userId": r.USER, "identityProviderId": "", "rights": [
            {"kind": {"CanActAs": {"value": {"party": firms[f]}}}}, {"kind": {"CanReadAs": {"value": {"party": firms[f]}}}}]})
    a, b, c = firms["A"], firms["B"], firms["C"]
    trade = {}
    for ref, x, y in [("t1", a, b), ("t2", b, c), ("t3", c, a)]:
        r.must_submit(3, [x, y], [r.create(r.T_TRADE, {"cptyA": x, "cptyB": y, "tradeRef": f"{ref}-{run}",
                                                        "terms": f"enc-{ref}", "commitment": f"h-{ref}", "auditors": []})])
        trade[ref] = r.find(3, x, r.T_TRADE, lambda arg, q=ref: arg["tradeRef"] == f"{q}-{run}")
    salt = {a: f"sa-{run}", b: f"sb-{run}", c: f"sc-{run}"}
    bundles = {a: ["rAB", "rCA"], b: ["rAB", "rBC"], c: ["rBC", "rCA"]}
    gate_id = f"g-{run}"
    permit = {}
    for ref, x, y, t, legs in [
            ("rAB", a, b, "t1", [{"cptyA": a, "cptyB": b, "tradeRef": f"n1-{run}", "terms": "enc-40", "commitment": "h-40"}]),
            ("rBC", b, c, "t2", []), ("rCA", c, a, "t3", [])]:
        p = {"cptyA": x, "cptyB": y, "executor": e, "gateId": gate_id, "permitRef": ref,
             "teardown": [trade[t]["contractId"]], "legs": legs,
             "bundleA": r.bundle_hash(bundles[x], salt[x]), "bundleB": r.bundle_hash(bundles[y], salt[y]),
             "deadline": deadline}
        r.must_submit(3, [x], [r.create(r.T_PROP, {"permit": p})])
        prop = r.find(3, y, r.T_PROP, lambda arg, q=ref: arg["permit"]["permitRef"] == q and arg["permit"]["gateId"] == gate_id)
        r.must_submit(3, [y], [r.exercise(r.T_PROP, prop["contractId"], "PermitProposal_Accept", {})])
        permit[ref] = r.find(3, x, r.T_PERMIT, lambda arg, q=ref: arg["permitRef"] == q and arg["gateId"] == gate_id)["contractId"]
    disclosed = [{"contractId": trade[t]["contractId"], "templateId": trade[t]["templateId"],
                  "createdEventBlob": trade[t]["createdEventBlob"], "synchronizerId": trade[t]["_sync"]}
                 for t in ("t1", "t2", "t3")]
    return firms, salt, gate_id, permit, disclosed


def approve(e, m1, m2, gate_id, refs, permits, salt, deadline):
    """m1 proposes; m1 and m2 each confirm on their own node. Returns (proposal, confirmations)."""
    r.must_submit(1, [m1], [r.create(r.T_CYCLE, {
        "governanceParty": e, "proposer": m1, "gateId": gate_id, "permitRefs": refs, "permits": permits,
        "salts": [{"_1": p, "_2": v} for p, v in salt.items()], "deadline": deadline,
        "description": f"compression cycle {gate_id}"})])
    proposal = r.find(1, m1, r.T_CYCLE, lambda arg: arg["gateId"] == gate_id)["contractId"]
    rules = r.dm("GET", 1, f"/governance/state?party_id={e}")["state"]["contract_id"]
    confs = []
    for node, m in ((1, m1), (2, m2)):
        r.find(node, e, r.T_CYCLE, lambda arg: arg["gateId"] == gate_id)  # visible on that member's node
        r.must_submit(node, [m], [r.exercise(r.T_RULES, rules, "GovernanceRules_ConfirmAction",
                                             {"confirmer": m, "actionProposalCid": proposal})], read_as=[e])
        confs.append(r.find(node, e, T_CONF, lambda arg, q=m: arg["actionProposalCid"] == proposal and arg["confirmer"] == q)["contractId"])
    return rules, proposal, confs


def execute(e, m2, rules, proposal, confs, disclosed):
    return r.submit(2, [m2], [r.exercise(r.T_RULES, rules, "GovernanceRules_ExecuteConfirmedAction",
                                         {"executor": m2, "actionProposalCid": proposal, "confirmations": confs})],
                    read_as=[e], disclosed=disclosed)


def untouched(firms, run):
    held = {f: sorted(ev["createArgument"]["tradeRef"] for ev in r.acs(3, p, r.T_TRADE)) for f, p in firms.items()}
    want = {"A": sorted([f"t1-{run}", f"t3-{run}"]), "B": sorted([f"t1-{run}", f"t2-{run}"]),
            "C": sorted([f"t2-{run}", f"t3-{run}"])}
    return held == want, held


def case(label, needle, kind, prepare):
    run = uuid.uuid4().hex[:6]
    r.say(label)
    e, m1, m2, deadline, refs, wait_until = prepare["setup"](run)
    firms, salt, gate_id, permit, disclosed = ring(e, run, deadline)
    sel = [permit[q] for q in refs]
    rules, proposal, confs = approve(e, m1, m2, gate_id, refs, sel, salt, deadline)
    print(f"    both members confirmed a package of {len(refs)} permit(s)")
    if "after_approval" in prepare:
        prepare["after_approval"](firms, permit)
    if wait_until:
        delay = (wait_until - datetime.now(timezone.utc)).total_seconds()
        if delay > 0:
            print(f"    waiting {int(delay)}s for the deadline to pass")
            time.sleep(delay)
    code, out = execute(e, m2, rules, proposal, confs, disclosed)
    passed = r.expect_rejection(label, code, out, needle, kind)
    same, held = untouched(firms, run)
    r.RESULTS[label]["state_unchanged"] = same
    print(f"    every firm still holds its two original trades: {same}")
    return passed and same


def main():
    s = r.state()
    m1, m2 = s["MEMBER_1"], s["MEMBER_2"]
    e = next(p["party_id"] for p in r.dm("GET", 1, "/decentralized-parties")["parties"]
             if p["party_id"].startswith(r.PREFIX + "::"))

    def at(seconds):
        t = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        return t.strftime("%Y-%m-%dT%H:%M:%S.%fZ"), t

    four_hours = lambda run: (e, m1, m2, at(4 * 3600)[0], ["rAB", "rBC", "rCA"], None)
    results = [
        case("an approved package that leaves out a pair", "incomplete bundle", "Daml (package checks)", {
            "setup": lambda run: (e, m1, m2, at(4 * 3600)[0], ["rAB", "rBC"], None)}),
        case("a permit withdrawn after both members approved", "CONTRACT_NOT", "consumed contract (the withdrawn permit)", {
            "setup": four_hours,
            "after_approval": lambda firms, permit: (
                r.must_submit(3, [firms["C"]], [r.exercise(r.T_PERMIT, permit["rCA"], "Permit_Withdraw",
                                                           {"actor": firms["C"]})]),
                print("    firm C withdrew its C–A permit"))}),
    ]
    # The deadline is set at the start, so building the ring and approving it fit inside it.
    expiry_iso, expiry_t = at(240)
    results.append(case("an expired package", "past its deadline", "Daml (package checks)", {
        "setup": lambda run: (e, m1, m2, expiry_iso, ["rAB", "rBC", "rCA"], expiry_t + timedelta(seconds=10))}))

    out = f"{os.environ.get('CR_OUT_DIR', '.')}/failures-{int(time.time())}.json"
    import json
    json.dump(r.RESULTS, open(out, "w"), indent=2)
    r.say(f"{sum(results)}/{len(results)} cases behaved as expected; results in {out}")


if __name__ == "__main__":
    main()
