#!/usr/bin/env python3
"""Five firms, eight trades, two net legs: a governed compression cycle on the LocalNet sandbox.

Run after reproduce.sh (or rehearse.py), which creates the execution party, its GovernanceRules and the two
members. Firms A–E are on node 3; the execution party and the members are on nodes 1 and 2, as in rehearse.py.

The trades and the result are the scenario pinned in app/solver/fivefirm.test.ts and computed there by the
matcher (app/solver/match.ts): eight trades of one risk factor, gross 400, become A–B 50 and D–E 20, gross 70;
firm C nets out. Each of the eight counterparty pairs signs one permit for its own trades and legs only.

  1. Consent: both members approve the package, then firm E withdraws its E–C permit. Execution fails and
     every firm still holds its trades.
  2. E and C sign the E–C permit again. A new proposal: one confirmation is not enough; with both, the whole
     package executes in one transaction.
  3. Holdings, and what each party received (ledger-effects, classified by contract id and reference).

Economic terms are placeholders, as in the DevNet run.

Usage: multifirm.py <decentralization-manager-checkout> <dir-with-dars>
"""
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import rehearse as r
import failures as f

# app/solver/fivefirm.test.ts: (ref, long party, short party, amount)
TRADES = [("t1", "A", "B", 100), ("t2", "B", "C", 80), ("t3", "C", "A", 60), ("t4", "C", "D", 50),
          ("t5", "D", "B", 30), ("t6", "D", "E", 40), ("t7", "E", "C", 30), ("t8", "A", "E", 10)]
LEGS = [("n1", "A", "B", 50), ("n2", "D", "E", 20)]
FIRMS = "ABCDE"


def pair(x, y):
    return "".join(sorted((x, y)))


def main():
    s = r.state()
    m1, m2 = s["MEMBER_1"], s["MEMBER_2"]
    e = next(p["party_id"] for p in r.dm("GET", 1, "/decentralized-parties")["parties"]
             if p["party_id"].startswith(r.PREFIX + "::"))
    rules = r.dm("GET", 1, f"/governance/state?party_id={e}")["state"]["contract_id"]
    run = uuid.uuid4().hex[:6]
    deadline = (datetime.now(timezone.utc) + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    results = {"run": run, "scenario": {"trades": TRADES, "legs": LEGS,
                                        "gross_before": sum(t[3] for t in TRADES), "gross_after": sum(l[3] for l in LEGS)}}
    o_start3, o_start1 = r.ledger_end(3), r.ledger_end(1)

    r.say(f"Five firms on node 3, eight trades (gross {results['scenario']['gross_before']})")
    firm = {}
    for x in FIRMS:
        firm[x] = r.lapi(3, "/v2/parties", {"partyIdHint": f"crm-{x.lower()}-{run}", "identityProviderId": ""})[
            "partyDetails"]["party"]
        r.lapi(3, f"/v2/users/{r.USER}/rights", {"userId": r.USER, "identityProviderId": "", "rights": [
            {"kind": {"CanActAs": {"value": {"party": firm[x]}}}}, {"kind": {"CanReadAs": {"value": {"party": firm[x]}}}}]})
    trade, cid_pair = {}, {}
    for ref, x, y, amt in TRADES:
        r.must_submit(3, [firm[x], firm[y]], [r.create(r.T_TRADE, {
            "cptyA": firm[x], "cptyB": firm[y], "tradeRef": f"{ref}-{run}", "terms": f"enc-{ref}",
            "commitment": f"h-{ref}", "auditors": []})])
        trade[ref] = r.find(3, firm[x], r.T_TRADE, lambda a, q=ref: a["tradeRef"] == f"{q}-{run}")
        cid_pair[trade[ref]["contractId"]] = pair(x, y)
        print(f"    {ref}  {x}–{y}  {amt}")

    # One permit per counterparty pair: its trades to tear up, and its new legs.
    pairs = sorted({pair(x, y) for _, x, y, _ in TRADES} | {pair(x, y) for _, x, y, _ in LEGS})
    refs = {p: f"p{p}-{run}" for p in pairs}
    salt = {x: f"s{x.lower()}-{run}" for x in FIRMS}
    bundle = {x: r.bundle_hash([refs[p] for p in pairs if x in p], salt[x]) for x in FIRMS}

    def sign_permit(p):
        x, y = p[0], p[1]
        legs = [{"cptyA": firm[a], "cptyB": firm[b], "tradeRef": f"{ref}-{run}", "terms": f"enc-{ref}",
                 "commitment": f"h-{ref}"} for ref, a, b, _ in LEGS if pair(a, b) == p]
        body = {"cptyA": firm[x], "cptyB": firm[y], "executor": e, "gateId": f"g-{run}", "permitRef": refs[p],
                "teardown": [trade[t]["contractId"] for t, a, b, _ in TRADES if pair(a, b) == p], "legs": legs,
                "bundleA": bundle[x], "bundleB": bundle[y], "deadline": deadline}
        r.must_submit(3, [firm[x]], [r.create(r.T_PROP, {"permit": body})])
        prop = r.find(3, firm[y], r.T_PROP, lambda a: a["permit"]["permitRef"] == refs[p])
        cid_pair[prop["contractId"]] = p
        r.must_submit(3, [firm[y]], [r.exercise(r.T_PROP, prop["contractId"], "PermitProposal_Accept", {})])
        cid = r.find(3, firm[x], r.T_PERMIT, lambda a: a["permitRef"] == refs[p])["contractId"]
        cid_pair[cid] = p
        return cid

    r.say(f"Eight pair permits, each signed by its two firms only (executor: the execution party, gate g-{run})")
    permit = {p: sign_permit(p) for p in pairs}
    for x in FIRMS:
        print(f"    firm {x} signs {len([p for p in pairs if x in p])} of {len(pairs)}: {[p for p in pairs if x in p]}")
    disclosed = [{"contractId": t["contractId"], "templateId": t["templateId"], "createdEventBlob": t["createdEventBlob"],
                  "synchronizerId": t["_sync"]} for t in trade.values()]

    def propose(tag):
        r.must_submit(1, [m1], [r.create(r.T_CYCLE, {
            "governanceParty": e, "proposer": m1, "gateId": f"g-{run}", "permitRefs": [refs[p] for p in pairs],
            "permits": [permit[p] for p in pairs], "salts": [{"_1": firm[x], "_2": salt[x]} for x in FIRMS],
            "deadline": deadline, "description": f"five-firm compression cycle {run} ({tag})"})])
        return r.find(1, m1, r.T_CYCLE, lambda a: a["description"].endswith(f"({tag})"))["contractId"]

    def confirm(node, m, proposal, tag):
        r.find(node, e, r.T_CYCLE, lambda a: a["description"].endswith(f"({tag})"))  # visible on that member's node
        r.must_submit(node, [m], [r.exercise(r.T_RULES, rules, "GovernanceRules_ConfirmAction",
                                             {"confirmer": m, "actionProposalCid": proposal})], read_as=[e])
        return r.find(node, e, f.T_CONF, lambda a: a["actionProposalCid"] == proposal and a["confirmer"] == m)["contractId"]

    def holdings():
        mine = set(f"{t[0]}-{run}" for t in TRADES) | set(f"{l[0]}-{run}" for l in LEGS)
        return {x: sorted(ev["createArgument"]["tradeRef"].split("-")[0] for ev in r.acs(3, firm[x], r.T_TRADE)
                          if ev["createArgument"]["tradeRef"] in mine) for x in FIRMS}

    before = holdings()

    r.say("1. Both members approve; then firm E withdraws its E–C permit")
    p1 = propose("first")
    c1 = [confirm(1, m1, p1, "first"), confirm(2, m2, p1, "first")]
    r.must_submit(3, [firm["E"]], [r.exercise(r.T_PERMIT, permit["CE"], "Permit_Withdraw", {"actor": firm["E"]})])
    code, out = f.execute(e, m2, rules, p1, c1, disclosed)
    r.expect_rejection("a firm withdrew after approval: nothing executes", code, out, "CONTRACT_NOT",
                       "consumed contract (the withdrawn permit)")
    results["withdrawal_state_unchanged"] = holdings() == before
    print(f"    every firm still holds all its trades: {results['withdrawal_state_unchanged']}")

    r.say("2. E and C sign the E–C permit again; a new proposal")
    permit["CE"] = sign_permit("CE")
    p2 = propose("second")
    first = confirm(1, m1, p2, "second")
    code, out = f.execute(e, m2, rules, p2, [first], disclosed)
    r.expect_rejection("one confirmation is not enough", code, out, "Enough confirmations", "Daml (GovernanceRules)")
    both = [first, confirm(2, m2, p2, "second")]
    code, out = f.execute(e, m2, rules, p2, both, disclosed)
    results["execution"] = {"http": code, "detail": str(out)[:300]}
    if code != 200:
        raise SystemExit(f"execution failed: {code} {str(out)[:600]}")
    print(f"    executed with both confirmations, one transaction: http {code}")

    after = r.poll(lambda: (lambda h: h if h != before else None)(holdings()), "settlement")
    for ev in [ev for x in FIRMS for ev in r.acs(3, firm[x], r.T_TRADE)]:
        ref = ev["createArgument"]["tradeRef"].split("-")[0]
        for lref, a, b, _ in LEGS:
            if ref == lref:
                cid_pair[ev["contractId"]] = pair(a, b)
    results["holdings_before"], results["holdings_after"] = before, after
    r.say("3. Holdings")
    for x in FIRMS:
        print(f"    {x}: {', '.join(before[x])}  →  {', '.join(after[x]) or 'nothing'}")
    print(f"    gross {results['scenario']['gross_before']} → {results['scenario']['gross_after']}; "
          f"{len(TRADES)} trades → {len(LEGS)} legs")
    expected = {"A": ["n1"], "B": ["n1"], "C": [], "D": ["n2"], "E": ["n2"]}
    results["holdings_as_planned"] = after == expected
    print(f"    as planned by the matcher: {results['holdings_as_planned']}")

    r.say("What each party received (ledger-effects for this run)")
    ref_pair = {f"{t[0]}-{run}": pair(t[1], t[2]) for t in TRADES}
    ref_pair.update({f"{l[0]}-{run}": pair(l[1], l[2]) for l in LEGS})
    ref_pair.update({v: k for k, v in refs.items()})
    gov = {"CycleExecutionProposal", "GovernanceRules", "GovernanceConfirmation", "GovernanceExecutionResult"}
    report = {}
    for who, node, party, begin in [(x, 3, firm[x], o_start3) for x in FIRMS] + [("execution party (node 1)", 1, e, o_start1)]:
        evs = r.tree(node, party, begin, r.ledger_end(node))
        seen = sorted({ref_pair.get(ref) or cid_pair.get(cid) for _, _, _, ref, cid in evs} - {None})
        unknown = sorted({tmpl for _, tmpl, _, ref, cid in evs if not (ref_pair.get(ref) or cid_pair.get(cid))} - gov)
        own = [p for p in pairs if who[0] in p] if who in FIRMS else pairs
        report[who] = {"events": len(evs), "pairs_seen": seen, "foreign_pairs": sorted(set(seen) - set(own)),
                       "governance": sorted({tmpl for _, tmpl, _, _, _ in evs} & gov), "unclassified": unknown}
        print(f"    {who:26} {len(seen)} of {len(pairs)} pairs {seen}  foreign {report[who]['foreign_pairs']}  "
              f"governance {report[who]['governance']}")
    results["visibility"] = report
    results["checks"] = r.RESULTS

    out_path = f"{os.environ.get('CR_OUT_DIR', '.')}/multifirm-{run}.json"
    json.dump(results, open(out_path, "w"), indent=2)
    r.say(f"Results written to {out_path}")


if __name__ == "__main__":
    main()
