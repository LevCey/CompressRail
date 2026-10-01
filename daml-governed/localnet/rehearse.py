#!/usr/bin/env python3
"""Governed compression cycle on Decentralization Manager's LocalNet sandbox.

Runs against the three-node sandbox from DLC-link/decentralization-manager
(`hackathon/up.sh` + `hackathon/seed.sh`, which allocates one member party per
node). Node roles here:

  node 1  hosts E, member m1 (the operator's member)      DecMan :8081, JSON API :3975
  node 2  hosts E, member m2 (the independent member)     DecMan :8082, JSON API :2975
  node 3  hosts the three firms, and does not host E      JSON API :4975

E is a dedicated Decentralized Party for compression only: two owners (nodes 1
and 2), threshold 2. The script distributes our DARs, deploys GovernanceRules
for E, creates a ring of trades and pair permits on node 3, proposes the cycle
on node 1, confirms on nodes 1 and 2, executes through the tool's API, runs
negative tests, and reads each party's ledger-effects stream to record which
trade events each one received.

LocalNet only: the bearer token below is the sandbox's published development
token and authorizes nothing anywhere else.

Usage: rehearse.py <path-to-decentralization-manager-checkout> <dir-with-dars>
       CR_OFFLINE=1 rehearse.py ...   also take node 2 offline before executing
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

REPO, DARS = sys.argv[1], sys.argv[2]
STATE = f"{REPO}/hackathon/.state"
TOKEN = next(l.split("=", 1)[1].strip().strip('"') for l in open(f"{REPO}/hackathon/localnet.sh")
             if l.startswith("LOCALNET_CANTON_TOKEN="))
DM = {1: 8081, 2: 8082, 3: 8083}
LEDGER = {1: 3975, 2: 2975, 3: 4975}
USER = "ledger-api-user"
PREFIX = "cr-exec"
PLACEHOLDER = {"type": "governance_set_threshold", "new_threshold": 0}
T_TRADE = "#compressrail:CompressRail.Trade:BilateralTrade"
T_PROP = "#compressrail:CompressRail.Gate:PermitProposal"
T_PERMIT = "#compressrail:CompressRail.Gate:ExecutionPermit"
T_CYCLE = "#compressrail-governed:CompressRail.Governed:CycleExecutionProposal"
T_RULES = "#governance-core-v1:Governance.Rules:GovernanceRules"
RESULTS = {}


def say(msg):
    print(f"\n==> {msg}", flush=True)


def http(method, url, body=None, token=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text.strip() else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, text


def ok(method, url, body=None, **kw):
    code, out = http(method, url, body, **kw)
    if not 200 <= code < 300:
        raise RuntimeError(f"{method} {url} -> {code}: {str(out)[:600]}")
    return out


def dm(method, node, path, body=None):
    return ok(method, f"http://localhost:{DM[node]}{path}", body)


def lapi(node, path, body=None, method="POST"):
    return ok(method, f"http://localhost:{LEDGER[node]}{path}", body, token=TOKEN)


def poll(fn, what, tries=120, wait=2):
    for _ in range(tries):
        v = fn()
        if v:
            return v
        time.sleep(wait)
    raise RuntimeError(f"timed out waiting for {what}")


def accept_invitation(node, kind):
    def find():
        inv = dm("GET", node, "/invitations").get("invitations") or []
        return next((i["id"] for i in inv if i.get("invitation_type") == kind), None)
    inv_id = poll(find, f"a {kind} invitation on node {node}")
    dm("POST", node, "/invitations/accept", {"id": inv_id})
    print(f"    node {node} accepted the {kind} invitation")


def wait_workflow(node, path, what):
    def done():
        st = dm("GET", node, path) or {}
        if st.get("status") in ("failed", "cancelled"):
            raise RuntimeError(f"{what} {st.get('status')}: {st.get('error')}")
        return st.get("status") == "completed"
    poll(done, what, tries=180)
    print(f"    {what} completed")


def state():
    return dict(l.strip().split("=", 1) for l in open(STATE) if "=" in l)


# ---------- ledger helpers ----------

def ledger_end(node):
    return lapi(node, "/v2/state/ledger-end", method="GET")["offset"]


def submit(node, act_as, commands, read_as=(), disclosed=()):
    body = {"commands": commands, "actAs": list(act_as), "readAs": list(read_as), "userId": USER,
            "commandId": str(uuid.uuid4())}
    if disclosed:
        body["disclosedContracts"] = list(disclosed)
    return http("POST", f"http://localhost:{LEDGER[node]}/v2/commands/submit-and-wait", body, token=TOKEN)


def must_submit(node, act_as, commands, **kw):
    code, out = submit(node, act_as, commands, **kw)
    if code != 200:
        raise RuntimeError(f"submit on node {node} as {act_as} -> {code}: {str(out)[:800]}")
    return out


def create(template, args):
    return {"CreateCommand": {"templateId": template, "createArguments": args}}


def exercise(template, cid, choice, arg):
    return {"ExerciseCommand": {"templateId": template, "contractId": cid, "choice": choice, "choiceArgument": arg}}


def acs(node, party, template, blobs=False):
    off = ledger_end(node)
    body = {"activeAtOffset": off, "eventFormat": {"filtersByParty": {party: {"cumulative": [
        {"identifierFilter": {"TemplateFilter": {"value": {"templateId": template, "includeCreatedEventBlob": blobs}}}}]}},
        "verbose": True}}
    out = lapi(node, "/v2/state/active-contracts", body)
    res = []
    for it in out or []:
        j = (it.get("contractEntry") or {}).get("JsActiveContract") or {}
        ev = j.get("createdEvent")
        if ev:
            ev["_sync"] = j.get("synchronizerId")
            res.append(ev)
    return res


def find(node, party, template, pred):
    return poll(lambda: next((e for e in acs(node, party, template, blobs=True) if pred(e["createArgument"])), None),
                f"{template} for {party[:20]} on node {node}", tries=60)


def tree(node, party, begin, end):
    """Every event in `party`'s ledger-effects projection in (begin, end]."""
    body = {"beginExclusive": begin, "endInclusive": end, "updateFormat": {"includeTransactions": {
        "eventFormat": {"filtersByParty": {party: {"cumulative": [
            {"identifierFilter": {"WildcardFilter": {"value": {"includeCreatedEventBlob": False}}}}]}}, "verbose": True},
        "transactionShape": "TRANSACTION_SHAPE_LEDGER_EFFECTS"}}}
    out = lapi(node, "/v2/updates", body) or []
    evs = []
    for it in out:
        tx = ((it.get("update") or {}).get("Transaction") or {}).get("value") or {}
        for ev in tx.get("events", []):
            for kind, v in ev.items():
                tmpl = v.get("templateId", "?").split(":")[-1]
                arg = v.get("createArgument") or {}
                ref = arg.get("tradeRef") or arg.get("permitRef") or (arg.get("permit") or {}).get("permitRef")
                evs.append((kind.replace("Event", ""), tmpl, v.get("choice", ""), ref, v.get("contractId")))
    return evs


def bundle_hash(refs, salt):
    return hashlib.sha256(("|".join(sorted(refs)) + "#" + salt).encode()).hexdigest()


def expect_rejection(label, code, out, needle, kind):
    text = json.dumps(out) if not isinstance(out, str) else out
    passed = code != 200 and (needle in text)
    RESULTS[label] = {"rejected": code != 200, "reason_matches": needle in text, "enforced_by": kind,
                      "detail": text[:300]}
    print(f"    {'PASS' if passed else 'FAIL'}  {label}  [{kind}]  http {code}")
    return passed


def node2_connectivity(connect):
    call = "ReconnectSynchronizer" if connect else "DisconnectSynchronizer"
    body = json.dumps({"synchronizer_alias": "global", **({"retry": True} if connect else {})})
    subprocess.run(["grpcurl", "-plaintext", "-d", body, "localhost:2902",
                    f"com.digitalasset.canton.admin.participant.v30.SynchronizerConnectivityService/{call}"],
                   check=True, capture_output=True)


def offline_test(m1, e, rules, proposal, both, disclosed, firms, down_seconds=120):
    """2-of-2 hosting. While one of E's hosts is offline the execution cannot complete; if the host
    stays down past the confirmation timeout the pending request is rejected with no effect; once it is
    back, the same confirmations execute the package. (A host that returns *within* the timeout lets the
    pending request complete — observed in an earlier run.)"""
    def held():
        return {f: sorted(ev["createArgument"]["tradeRef"][:2] for ev in acs(3, p, T_TRADE)) for f, p in firms.items()}
    before = held()
    cmd = [exercise(T_RULES, rules, "GovernanceRules_ExecuteConfirmedAction",
                    {"executor": m1, "actionProposalCid": proposal, "confirmations": both})]
    node2_connectivity(False)
    print("    node 2 disconnected from the synchronizer")
    try:
        t0 = time.time()
        code, out = submit(1, [m1], cmd, read_as=[e], disclosed=disclosed)
        RESULTS["offline_submit"] = {"http": code, "seconds": round(time.time() - t0, 1), "detail": str(out)[:300]}
        print(f"    submit with node 2 offline returned http {code} after {RESULTS['offline_submit']['seconds']}s")
        while time.time() - t0 < down_seconds:
            time.sleep(5)
        RESULTS["offline_unchanged_while_down"] = held() == before
        print(f"    after {down_seconds}s offline, state unchanged: {RESULTS['offline_unchanged_while_down']}")
    finally:
        node2_connectivity(True)
        print("    node 2 reconnected")
    time.sleep(45)
    RESULTS["offline_unchanged_after_reconnect"] = held() == before
    print(f"    45s after reconnecting, state still unchanged (request timed out): {RESULTS['offline_unchanged_after_reconnect']}")
    code, out = submit(1, [m1], cmd, read_as=[e], disclosed=disclosed)
    RESULTS["offline_resubmit"] = {"http": code, "detail": str(out)[:300]}
    print(f"    resubmitting with the same confirmations: http {code}")
    if code != 200:
        raise RuntimeError(f"resubmission failed: {str(out)[:400]}")


# ---------- the run ----------

def main():
    s = state()
    m1, m2 = s["MEMBER_1"], s["MEMBER_2"]
    pid = {i: dm("GET", i, "/node-config")["node"]["participant_id"] for i in (1, 2, 3)}
    run = uuid.uuid4().hex[:6]

    say("E: a dedicated Decentralized Party for compression (owners: nodes 1 and 2, threshold 2)")
    existing = [p for p in dm("GET", 1, "/decentralized-parties").get("parties", [])
                if p["party_id"].startswith(PREFIX + "::")]
    if existing:
        e = existing[0]["party_id"]
        print("    reusing", e)
    else:
        dm("POST", 1, "/onboarding", {"party_id_prefix": PREFIX, "peer_ids": [pid[2]], "threshold": 2})
        accept_invitation(2, "Onboarding")
        wait_workflow(1, "/onboarding/status", "onboarding")
        e = poll(lambda: next((p["party_id"] for p in dm("GET", 1, "/decentralized-parties").get("parties", [])
                               if p["party_id"].startswith(PREFIX + "::")), None), "E in /decentralized-parties")
    info = next(p for p in dm("GET", 1, "/decentralized-parties")["parties"] if p["party_id"] == e)
    RESULTS["E_topology_as_reported"] = {k: v for k, v in info.items() if k != "contracts"}
    print(f"    E = {e}\n    reported threshold {info.get('threshold')}, owners {len(info.get('owners', []))}, "
          f"participants {[(p['participant_uid'][:22], p.get('permission')) for p in info.get('participants', [])]}")

    say("Our DARs: distributed to node 2 through the tool; compressrail uploaded to the firms' node 3")
    if not s.get("CR_DARS_DONE"):
        files = []
        for name in ("compressrail-0.0.3.dar", "compressrail-governed-0.0.1.dar"):
            files.append({"filename": name, "data": base64.b64encode(open(f"{DARS}/{name}", "rb").read()).decode()})
        dm("POST", 1, "/dars/distribute", {"dar_files": files, "peer_ids": [pid[2]]})
        accept_invitation(2, "Dars")
        wait_workflow(1, "/dars/distribute/status", "DAR distribution")
        ok("POST", f"http://localhost:{LEDGER[3]}/v2/packages", raw=open(f"{DARS}/compressrail-0.0.3.dar", "rb").read(),
           token=TOKEN, ctype="application/octet-stream")
        # The coordinator's own participant: upload too, in case distribution only targets peers.
        for name in ("compressrail-0.0.3.dar", "compressrail-governed-0.0.1.dar"):
            ok("POST", f"http://localhost:{LEDGER[1]}/v2/packages", raw=open(f"{DARS}/{name}", "rb").read(),
               token=TOKEN, ctype="application/octet-stream")
        with open(STATE, "a") as f:
            f.write("CR_DARS_DONE=1\n")
        print("    done")

    say("Rights and party configuration for E on nodes 1 and 2")
    for i in (1, 2):
        lapi(i, f"/v2/users/{USER}/rights", {"userId": USER, "identityProviderId": "", "rights": [
            {"kind": {"CanActAs": {"value": {"party": e}}}}, {"kind": {"CanReadAs": {"value": {"party": e}}}}]})
        dm("PUT", i, "/party-config", {"dec_party_id": e, "member_party_id": (m1 if i == 1 else m2),
                                         "user_id": USER, "keycloak_url": "", "keycloak_realm": "",
                                         "keycloak_client_id": ""})

    say("GovernanceRules for E: members m1, m2, threshold 2")
    rules = ((dm("GET", 1, f"/governance/state?party_id={e}") or {}).get("state") or {}).get("contract_id")
    if not rules:
        dm("POST", 1, "/contracts", {
            "decentralized_party_id": e, "participant_ids": [pid[1], pid[2]], "participant_parties": [m1, m2],
            "operator_party": m1,
            "contracts": [{"id": "governance-rules", "name": "GovernanceRules", "package_id": "#governance-core-v1",
                           "module_name": "Governance.Rules", "entity_name": "GovernanceRules",
                           "fields": [{"type": "decentralized_party"}, {"type": "party_set", "parties": [m1, m2]},
                                      {"type": "int64", "value": 2}, {"type": "rel_time", "microseconds": 1800000000},
                                      {"type": "none"}]}]})
        accept_invitation(2, "Contracts")
        wait_workflow(1, "/contracts/status", "contract deployment")
        rules = poll(lambda: ((dm("GET", 1, f"/governance/state?party_id={e}") or {}).get("state") or {}).get("contract_id"),
                     "the GovernanceRules contract")
    rules_arg = find(1, e, T_RULES, lambda a: True)["createArgument"]
    RESULTS["governance_rules"] = {"threshold": rules_arg.get("threshold"), "members": rules_arg.get("members")}
    print(f"    rules {rules[:16]}…  threshold {rules_arg.get('threshold')}")

    say("Firms A, B, C on node 3, a ring of trades, and pair permits")
    firms = {}
    for f in "ABC":
        firms[f] = lapi(3, "/v2/parties", {"partyIdHint": f"cr-firm-{f.lower()}-{run}", "identityProviderId": ""})[
            "partyDetails"]["party"]
        lapi(3, f"/v2/users/{USER}/rights", {"userId": USER, "identityProviderId": "", "rights": [
            {"kind": {"CanActAs": {"value": {"party": firms[f]}}}}, {"kind": {"CanReadAs": {"value": {"party": firms[f]}}}}]})
    a, b, c = firms["A"], firms["B"], firms["C"]
    o_start = ledger_end(3)
    ring = [("t1", a, b), ("t2", b, c), ("t3", c, a)]
    trade = {}
    for ref, x, y in ring:
        must_submit(3, [x, y], [create(T_TRADE, {"cptyA": x, "cptyB": y, "tradeRef": f"{ref}-{run}",
                                                  "terms": f"enc-{ref}", "commitment": f"h-{ref}", "auditors": []})])
        trade[ref] = find(3, x, T_TRADE, lambda arg, r=ref: arg["tradeRef"] == f"{r}-{run}")
    deadline = (datetime.now(timezone.utc) + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    salt = {a: f"salt-a-{run}", b: f"salt-b-{run}", c: f"salt-c-{run}"}
    bundles = {a: ["rAB", "rCA"], b: ["rAB", "rBC"], c: ["rBC", "rCA"]}
    gate_id = f"g-{run}"
    specs = [("rAB", a, b, "t1", [{"cptyA": a, "cptyB": b, "tradeRef": f"n1-{run}", "terms": "enc-40", "commitment": "h-40"}]),
             ("rBC", b, c, "t2", []), ("rCA", c, a, "t3", [])]
    permit = {}
    for ref, x, y, t, legs in specs:
        p = {"cptyA": x, "cptyB": y, "executor": e, "gateId": gate_id, "permitRef": ref,
             "teardown": [trade[t]["contractId"]], "legs": legs,
             "bundleA": bundle_hash(bundles[x], salt[x]), "bundleB": bundle_hash(bundles[y], salt[y]),
             "deadline": deadline}
        must_submit(3, [x], [create(T_PROP, {"permit": p})])
        prop = find(3, y, T_PROP, lambda arg, r=ref: arg["permit"]["permitRef"] == r and arg["permit"]["gateId"] == gate_id)
        must_submit(3, [y], [exercise(T_PROP, prop["contractId"], "PermitProposal_Accept", {})])
        permit[ref] = find(3, x, T_PERMIT, lambda arg, r=ref: arg["permitRef"] == r and arg["gateId"] == gate_id)["contractId"]
    print(f"    firms {[p[:14] for p in (a, b, c)]}, 3 trades, 3 permits")
    find(1, e, T_PERMIT, lambda arg: arg["gateId"] == gate_id and arg["permitRef"] == "rCA")  # E's nodes see the permits

    say("m1 proposes the cycle on node 1")
    must_submit(1, [m1], [create(T_CYCLE, {
        "governanceParty": e, "proposer": m1, "gateId": gate_id, "permitRefs": ["rAB", "rBC", "rCA"],
        "permits": [permit["rAB"], permit["rBC"], permit["rCA"]],
        "salts": [{"_1": p, "_2": v} for p, v in salt.items()], "deadline": deadline,
        "description": f"compression cycle {gate_id}"})])
    proposal = find(1, m1, T_CYCLE, lambda arg: arg["gateId"] == gate_id)["contractId"]
    print(f"    proposal {proposal[:16]}…")
    disclosed = [{"contractId": trade[t]["contractId"], "templateId": trade[t]["templateId"],
                  "createdEventBlob": trade[t]["createdEventBlob"], "synchronizerId": trade[t]["_sync"]}
                 for t in ("t1", "t2", "t3")]

    say("Negative tests before the threshold is met")
    confirm = {"party_id": e, "rules_contract_id": rules, "action": PLACEHOLDER, "governance_type": "core_domain",
               "proposal_cid": proposal}
    dm("POST", 1, "/governance/confirm", confirm)

    def my_confirmations():
        acts = dm("GET", 1, f"/governance/confirmations?party_id={e}").get("domain_actions") or []
        act = next((x for x in acts if x.get("proposal_cid") == proposal), None)
        return act and [c["contract_id"] for c in act.get("confirmations", [])]
    c1 = poll(my_confirmations, "m1's confirmation")
    code, out = submit(1, [m1], [exercise(T_RULES, rules, "GovernanceRules_ExecuteConfirmedAction",
                                          {"executor": m1, "actionProposalCid": proposal, "confirmations": c1})],
                       read_as=[e], disclosed=disclosed)
    expect_rejection("one confirmation cannot execute", code, out, "Enough confirmations", "Daml (GovernanceRules)")
    code, out = submit(1, [m1], [exercise(T_PERMIT, permit["rAB"], "Permit_Execute", {})], read_as=[e],
                       disclosed=disclosed)
    expect_rejection("a member cannot exercise a permit", code, out, "DAML_AUTHORIZATION_ERROR", "Daml authorization")
    code, out = submit(1, [e], [exercise(T_PERMIT, permit["rAB"], "Permit_Execute", {})], disclosed=disclosed)
    expect_rejection("node 1 cannot submit as E alone", code, out, "NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT", "Canton topology")

    say("m2 confirms on node 2; the tool executes with both confirmations")
    poll(lambda: any(x.get("proposal_cid") == proposal for x in
                     dm("GET", 2, f"/governance/confirmations?party_id={e}").get("domain_actions") or []),
         "the proposal on node 2")
    dm("POST", 2, "/governance/confirm", confirm)
    both = poll(lambda: (lambda xs: xs if xs and len(xs) >= 2 else None)(my_confirmations()), "two confirmations")
    o_before_exec = ledger_end(3)
    if os.environ.get("CR_OFFLINE") == "1":
        offline_test(m1, e, rules, proposal, both, disclosed, firms)
    else:
        dm("POST", 2, "/governance/execute", {
            "party_id": e, "rules_contract_id": rules, "action": PLACEHOLDER, "governance_type": "core_domain",
            "proposal_cid": proposal, "confirmation_cids": both,
            "disclosed_contracts": [{"contract_id": d["contractId"], "blob": d["createdEventBlob"]} for d in disclosed]})

    def settled():
        held = {f: [ev["createArgument"]["tradeRef"] for ev in acs(3, p, T_TRADE)] for f, p in firms.items()}
        return held if not any(r.startswith(("t1-", "t2-", "t3-")) for v in held.values() for r in v) else None
    held = poll(settled, "the cycle to settle on node 3", tries=90)
    RESULTS["after_execution"] = held
    print(f"    trades held after: {held}")

    say("Replay after execution")
    code, out = submit(1, [m1], [exercise(T_RULES, rules, "GovernanceRules_ExecuteConfirmedAction",
                                          {"executor": m1, "actionProposalCid": proposal, "confirmations": both})],
                       read_as=[e], disclosed=disclosed)
    expect_rejection("replay is rejected", code, out, "CONTRACT_NOT_FOUND", "Daml (consumed contracts)")

    say("What each party received (ledger-effects, from the first trade to the end)")
    end3, end1 = ledger_end(3), ledger_end(1)
    seen = {}
    for f, p in firms.items():
        seen[f] = tree(3, p, o_start, end3)
    seen["E (node 1)"] = tree(1, e, 0, end1)
    pair_of = {"rAB": "AB", "rBC": "BC", "rCA": "CA", f"t1-{run}": "AB", f"t2-{run}": "BC", f"t3-{run}": "CA",
               f"n1-{run}": "AB"}
    mine = {"A": {"AB", "CA"}, "B": {"AB", "BC"}, "C": {"BC", "CA"}}
    report = {}
    for who, evs in seen.items():
        tmpls = sorted({t for _, t, _, _, _ in evs})
        pairs = sorted({pair_of[r] for _, _, _, r, _ in evs if r in pair_of})
        foreign = sorted(set(pairs) - mine[who]) if who in mine else []
        report[who] = {"templates": tmpls, "pairs_seen": pairs, "foreign_pairs": foreign,
                       "saw_proposal_or_governance": [t for t in tmpls if t in
                                                      ("CycleExecutionProposal", "GovernanceRules",
                                                       "GovernanceConfirmation", "GovernanceExecutionResult")]}
        print(f"    {who:11} pairs {pairs}  foreign {foreign}  governance/proposal {report[who]['saw_proposal_or_governance']}")
    RESULTS["visibility"] = report

    out_path = f"/root/rehearsal-{run}.json"
    json.dump({"run": run, "E": e, "rules": rules, "firms": firms, "results": RESULTS}, open(out_path, "w"), indent=2)
    say(f"Results written to {out_path}")


if __name__ == "__main__":
    main()
