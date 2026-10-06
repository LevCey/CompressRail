#!/usr/bin/env python3
"""Governed compression cycle on Canton DevNet.

Runs on the host of the operator participant. Parties and nodes:

  our validator          firms A and C            Ledger API 127.0.0.1:80 (Host json-ledger-api.localhost)
  HackCanton (NODERS)    firm B                   driven separately by firm B's own credentials
  operator participant   E and our member         Ledger API 127.0.0.1:8081, Decentralization Manager 127.0.0.1:8095
  BitSafe's node         E and BitSafe's member   BitSafe's member confirms from BitSafe's node

E (`compressrail-exec`) is a Decentralized Party hosted on the operator participant and BitSafe's node,
with every threshold at 2, governed by one GovernanceRules contract (members: ours and BitSafe's,
threshold 2). The cycle is the A–B, C–B, C–A ring: three trades, one permit per pair, and a net A–B leg.

Phases, in order:
  setup     allocate A and C; create trade C–A; propose trades A–B and C–B to firm B
  permits   (after B accepted both trades) propose permits A–B and C–B to B; create permit C–A
  check     read-only: rules, E's contracts, permits, trades, topology
  propose   our member creates the CycleExecutionProposal
  confirm   our member confirms (GovernanceRules_ConfirmAction); executing with only that confirmation must
            fail; two bypass attempts must fail; nothing may change
  status    confirmations on the proposal
  execute   (after BitSafe's member confirmed) re-check everything, execute (GovernanceRules_ExecuteConfirmedAction),
            verify
  evidence  ledger-effects of A, C and E for this run, plus topology and rules after

Our side submits the confirm and execute choices of GovernanceRules directly on the Ledger API, as our member
with an explicit user id. The manager's own confirm/execute endpoints rely on the participant deriving the user
id from a token, and the operator participant runs with Ledger API authentication disabled. The on-ledger
checks are the same: they are in GovernanceRules.

Economic terms are opaque placeholders in this run: the point is governance and visibility. Every firm's
bundle salt is generated here, so the firms' secrets share one process (stated limit).

Configuration: the defaults below are the deployment this ran on (6 October 2026). Override them with the
CR_* environment variables to run against another Decentralized Party; see the README in this directory.
"""
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

env = os.environ.get
E = env("CR_EXEC_PARTY", "compressrail-exec::1220c513df48a6ebb51997e71d12888cf832d4d63e794afcf497b3466a13b4e3340b")
MEMBER = env("CR_MEMBER", "compressrail-member::12208d9dd0808f8345d89ba250d2cc261c932c05909e64243dc4fcb7d8b685171eb2")
BITSAFE_MEMBER = env("CR_PEER_MEMBER", "attestor-1::1220fa8543db6c66fe3a55b1f180c8dfc7f876265c76684fbc1d35d89e02c8aafe8e")
FIRM_B = env("CR_FIRM_B",
             "04a88dea-f608-4bd2-9eb4-2703c1398a98::12204a9d883d1158141d8f099d06dd2e42cb52615deb42da5a46f042c8d0e1dbdf0e")

CR_PKG = "a6f77b297c7fda8dfadc10a7211a6755f82451c70d5fc6854cef1a7094b6f619"     # compressrail 0.0.3
GOV_PKG = "d7ea09960153f96d4f7667cb1530bf55889256f3f9e7c3d1e4186bdb04ed7ddc"    # compressrail-governed 0.0.1
RULES_PKG = "361d1f2857f833f8094caf86ecdd5daaa3e2075c22dafe2bf18cde63ee98d488"  # governance-core-v1 0.1.0

T_TRADE = f"{CR_PKG}:CompressRail.Trade:BilateralTrade"
T_TPROP = f"{CR_PKG}:CompressRail.Trade:TradeProposal"
T_PERMIT = f"{CR_PKG}:CompressRail.Gate:ExecutionPermit"
T_PPROP = f"{CR_PKG}:CompressRail.Gate:PermitProposal"
T_CYCLE = f"{GOV_PKG}:CompressRail.Governed:CycleExecutionProposal"
T_RULES = f"{RULES_PKG}:Governance.Rules:GovernanceRules"
F_TRADE = "#compressrail:CompressRail.Trade:BilateralTrade"
F_PERMIT = "#compressrail:CompressRail.Gate:ExecutionPermit"
F_CYCLE = "#compressrail-governed:CompressRail.Governed:CycleExecutionProposal"
F_CONF = "#governance-core-v1:Governance.Confirmation:GovernanceConfirmation"

VAL = (env("CR_FIRMS_LEDGER", "http://127.0.0.1:80"), env("CR_FIRMS_USER", "compressrail"))     # hosts firms A and C
OP = (env("CR_EXEC_LEDGER", "http://127.0.0.1:8081"), env("CR_EXEC_USER", "ledger-api-user"))  # hosts E and our member
HOST_HEADER = env("CR_LEDGER_HOST_HEADER", "json-ledger-api.localhost")
DM = env("CR_MANAGER", "http://127.0.0.1:8095")
EXEC_CONTAINER = env("CR_EXEC_CONTAINER", "splice-validator-op-participant-1")  # for the Admin API address
EXEC_ADMIN = env("CR_EXEC_ADMIN")  # host:port of the Admin API; looked up from the container if unset
TOPOLOGY_SH = env("CR_TOPOLOGY_SH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "localnet", "topology.sh"))
PERMIT_DEADLINE = env("CR_PERMIT_DEADLINE", "2026-10-09T20:00:00.000000Z")
STATE_DIR = env("CR_STATE_DIR", "/root/devnet-cycle")
GOV_ENTITIES = {"CycleExecutionProposal", "GovernanceRules", "GovernanceConfirmation", "GovernanceExecutionResult",
                "GovernanceSelfConfirmation"}


# ---------- plumbing ----------

def http(method, url, body=None, host=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if host:
        req.add_header("Host", host)
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


def ledger(node, path, body=None, method=None):
    code, out = http(method or ("POST" if body is not None else "GET"), node[0] + path, body, HOST_HEADER)
    if not 200 <= code < 300:
        raise RuntimeError(f"{path} -> {code}: {str(out)[:600]}")
    return out


def dm(method, path, body=None):
    code, out = http(method, DM + path, body)
    if not 200 <= code < 300:
        raise RuntimeError(f"{path} -> {code}: {str(out)[:600]}")
    return out


def now():
    return datetime.now(timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def say(m):
    print(f"\n==> {m}", flush=True)


def ledger_end(node):
    return ledger(node, "/v2/state/ledger-end")["offset"]


def allocate(node, hint):
    return ledger(node, "/v2/parties", {"partyIdHint": hint, "identityProviderId": ""})["partyDetails"]["party"]


def submit(node, act_as, commands, read_as=(), disclosed=()):
    body = {"commands": commands, "actAs": list(act_as), "readAs": list(read_as), "userId": node[1],
            "commandId": str(uuid.uuid4())}
    if disclosed:
        body["disclosedContracts"] = list(disclosed)
    return http("POST", node[0] + "/v2/commands/submit-and-wait", body, HOST_HEADER)


def must(result, what):
    code, out = result
    if code != 200:
        raise RuntimeError(f"{what} failed: {code} {str(out)[:800]}")
    return out


def create(template, args):
    return {"CreateCommand": {"templateId": template, "createArguments": args}}


def exercise(template, cid, choice, arg):
    return {"ExerciseCommand": {"templateId": template, "contractId": cid, "choice": choice, "choiceArgument": arg}}


def acs(node, party, template=None, blobs=False):
    flt = ({"identifierFilter": {"TemplateFilter": {"value": {"templateId": template, "includeCreatedEventBlob": blobs}}}}
           if template else {"identifierFilter": {"WildcardFilter": {"value": {"includeCreatedEventBlob": blobs}}}})
    out = ledger(node, "/v2/state/active-contracts", {
        "activeAtOffset": ledger_end(node),
        "eventFormat": {"filtersByParty": {party: {"cumulative": [flt]}}, "verbose": True}})
    res = []
    for it in out or []:
        j = (it.get("contractEntry") or {}).get("JsActiveContract") or {}
        ev = j.get("createdEvent")
        if ev:
            ev["_sync"] = j.get("synchronizerId")
            res.append(ev)
    return res


def poll(fn, what, tries=60, wait=2):
    for _ in range(tries):
        v = fn()
        if v:
            return v
        time.sleep(wait)
    raise RuntimeError(f"timed out waiting for {what}")


def rnd():
    return secrets.token_hex(16)


def opaque():
    return "enc:" + secrets.token_hex(24), secrets.token_hex(32)


def bundle_hash(refs, salt):
    return hashlib.sha256(("|".join(sorted(refs)) + "#" + salt).encode()).hexdigest()


def load():
    run = open(f"{STATE_DIR}/current").read().strip()
    return json.load(open(f"{STATE_DIR}/{run}.json"))


def save(st):
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    path = f"{STATE_DIR}/{st['run']}.json"
    with open(path, "w") as f:
        json.dump(st, f, indent=2)
    os.chmod(path, 0o600)
    with open(f"{STATE_DIR}/current", "w") as f:
        f.write(st["run"])


def rules():
    """The live GovernanceRules contract of E, from E's own active contracts on the operator participant."""
    ev = [c for c in acs(OP, E) if c["templateId"].endswith(":Governance.Rules:GovernanceRules")]
    if len(ev) != 1:
        raise RuntimeError(f"expected exactly one GovernanceRules for compressrail-exec, found {len(ev)}")
    return ev[0]


def check_rules(r):
    a = r["createArgument"]
    members = sorted(m[0] for m in a["members"]["map"])
    ok = (r["templateId"].startswith(RULES_PKG) and a["governanceParty"] == E and members == sorted([MEMBER, BITSAFE_MEMBER])
          and str(a["threshold"]) == "2" and a.get("additionalProposers") in (None, {}) and r["signatories"] == [E])
    if not ok:
        raise RuntimeError(f"GovernanceRules differs from the agreed deployment: {json.dumps(a)[:500]}")
    return members


def topology():
    admin = EXEC_ADMIN
    if not admin:
        ip = subprocess.run(["docker", "inspect", EXEC_CONTAINER, "--format",
                             "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}"],
                            capture_output=True, text=True, check=True).stdout.split()[0]
        admin = f"{ip}:5002"
    sync = ledger(OP, "/v2/state/connected-synchronizers")["connectedSynchronizers"][0]["synchronizerId"]
    return subprocess.run([TOPOLOGY_SH, admin, E, sync], capture_output=True, text=True).stdout


def find_trade(party, ref):
    return poll(lambda: next((c for c in acs(VAL, party, F_TRADE, blobs=True)
                              if c["createArgument"]["tradeRef"] == ref), None), f"trade {ref[:8]} for {party[:12]}", tries=5)


def permits_of_e(st):
    return [c for c in acs(OP, E, F_PERMIT) if c["createArgument"]["gateId"] == st["gate_id"]]


def disclosed(st):
    A, C = st["parties"]["A"], st["parties"]["C"]
    out = []
    for party, key in ((A, "AB"), (C, "CB"), (A, "CA")):
        t = find_trade(party, st["trade_refs"][key])
        out.append({"contractId": t["contractId"], "templateId": t["templateId"],
                    "createdEventBlob": t["createdEventBlob"], "synchronizerId": t["_sync"]})
    return out


def confirmations(proposal):
    return [c for c in acs(OP, E, F_CONF) if c["createArgument"]["actionProposalCid"] == proposal]


# ---------- phases ----------

def setup():
    say("Pre-flight")
    r = rules()
    check_rules(r)
    print(f"    GovernanceRules {r['contractId'][:16]}… as agreed; compressrail-exec holds {len(acs(OP, E))} active contract(s)")
    run = secrets.token_hex(3)
    st = {"run": run, "started": iso(now()), "rules_cid": r["contractId"], "gate_id": f"devnet-{run}",
          "permit_deadline": PERMIT_DEADLINE,
          "offsets": {"val_begin": ledger_end(VAL), "op_begin": ledger_end(OP)},
          "trade_refs": {k: rnd() for k in ("AB", "CB", "CA")}, "leg_ref": rnd(),
          "permit_refs": {k: rnd() for k in ("AB", "CB", "CA")},
          "salts": {k: secrets.token_hex(16) for k in ("A", "B", "C")}}
    say("Firms A and C on our validator")
    A = allocate(VAL, f"cr-dn-a-{run}")
    C = allocate(VAL, f"cr-dn-c-{run}")
    st["parties"] = {"A": A, "B": FIRM_B, "C": C}
    print(f"    A {A[:30]}…\n    C {C[:30]}…\n    B {FIRM_B[:30]}… (HackCanton)")
    save(st)

    say("Trade C–A (both on our validator)")
    terms, commitment = opaque()
    must(submit(VAL, [C, A], [create(T_TRADE, {"cptyA": C, "cptyB": A, "tradeRef": st["trade_refs"]["CA"], "terms": terms,
                                              "commitment": commitment, "auditors": []})]), "trade C–A")
    say("Trade proposals A→B and C→B (firm B accepts them on HackCanton)")
    for proposer, key in ((A, "AB"), (C, "CB")):
        terms, commitment = opaque()
        must(submit(VAL, [proposer], [create(T_TPROP, {"proposer": proposer, "counterparty": FIRM_B,
                                                       "tradeRef": st["trade_refs"][key], "terms": terms,
                                                       "commitment": commitment, "auditors": []})]), f"proposal {key}")
    b_file = {"run": run, "firm_b": FIRM_B, "executor": E, "proposers": [A, C], "gate_id": st["gate_id"],
              "trade_refs": st["trade_refs"], "permit_refs": st["permit_refs"], "leg_ref": st["leg_ref"], "cr_pkg": CR_PKG}
    with open(f"{STATE_DIR}/{run}-b.json", "w") as f:
        json.dump(b_file, f, indent=2)
    save(st)
    say(f"Run {run} set up. Firm B now accepts the two trade proposals; then run: cycle.py permits")


def permits():
    st = load()
    A, B, C = st["parties"]["A"], st["parties"]["B"], st["parties"]["C"]
    say("Trades, including the two firm B accepted")
    tAB = find_trade(A, st["trade_refs"]["AB"])["contractId"]
    tCB = find_trade(C, st["trade_refs"]["CB"])["contractId"]
    tCA = find_trade(A, st["trade_refs"]["CA"])["contractId"]
    st["trade_cids"] = {"AB": tAB, "CB": tCB, "CA": tCA}
    print("    A–B, C–B and C–A found")
    refs, salt = st["permit_refs"], st["salts"]
    h = {"A": bundle_hash([refs["AB"], refs["CA"]], salt["A"]),
         "B": bundle_hash([refs["AB"], refs["CB"]], salt["B"]),
         "C": bundle_hash([refs["CB"], refs["CA"]], salt["C"])}

    def permit(a, b, key, teardown, legs, ha, hb):
        return {"cptyA": a, "cptyB": b, "executor": E, "gateId": st["gate_id"], "permitRef": refs[key],
                "teardown": [teardown], "legs": legs, "bundleA": ha, "bundleB": hb, "deadline": st["permit_deadline"]}
    terms, commitment = opaque()
    leg = {"cptyA": A, "cptyB": B, "tradeRef": st["leg_ref"], "terms": terms, "commitment": commitment}
    say("Permit proposals A–B and C–B (firm B accepts them), permit C–A")
    must(submit(VAL, [A], [create(T_PPROP, {"permit": permit(A, B, "AB", tAB, [leg], h["A"], h["B"])})]), "permit proposal A–B")
    must(submit(VAL, [C], [create(T_PPROP, {"permit": permit(C, B, "CB", tCB, [], h["C"], h["B"])})]), "permit proposal C–B")
    must(submit(VAL, [C, A], [create(T_PERMIT, permit(C, A, "CA", tCA, [], h["C"], h["A"]))]), "permit C–A")
    save(st)
    say("Done. Firm B now accepts the two permit proposals; then run: cycle.py check")


def check():
    st = load()
    say("GovernanceRules")
    r = rules()
    members = check_rules(r)
    same = r["contractId"] == st["rules_cid"]
    print(f"    {r['contractId'][:16]}… unchanged since setup: {same}; members {[m.split('::')[0] for m in members]}; threshold 2")
    if not same:
        raise RuntimeError("the rules contract changed since setup")
    say("compressrail-exec's active contracts")
    kinds = {}
    for c in acs(OP, E):
        k = c["templateId"].split(":", 1)[1]
        kinds[k] = kinds.get(k, 0) + 1
    for k, n in sorted(kinds.items()):
        print(f"    {n} × {k}")
    unexpected = [k for k in kinds if k.split(":")[-1] not in {"GovernanceRules", "ExecutionPermit", "CycleExecutionProposal",
                                                               "GovernanceConfirmation", "GovernanceExecutionResult"}]
    if unexpected:
        raise RuntimeError(f"unexpected contracts for compressrail-exec: {unexpected}")
    say("Permits of this run, as compressrail-exec's nodes see them")
    ps = permits_of_e(st)
    for p in ps:
        a = p["createArgument"]
        print(f"    {[k for k, v in st['permit_refs'].items() if v == a['permitRef']][0]}  executor compressrail-exec: {a['executor'] == E}  "
              f"deadline {a['deadline']}  signatories {[s.split('::')[0][:14] for s in p['signatories']]}")
    if len(ps) != 3:
        raise RuntimeError(f"expected 3 permits, found {len(ps)} — has firm B accepted both permit proposals?")
    st["permit_cids"] = {k: next(p["contractId"] for p in ps if p["createArgument"]["permitRef"] == v)
                         for k, v in st["permit_refs"].items()}
    save(st)
    say("Trades")
    disclosed(st)
    print("    all three active, blobs readable for disclosure")
    say("Topology of compressrail-exec")
    print(topology())


def propose():
    st = load()
    check()
    deadline = iso(now() + timedelta(hours=24))
    A, B, C = st["parties"]["A"], st["parties"]["B"], st["parties"]["C"]
    refs, cids = st["permit_refs"], st["permit_cids"]
    say("Our member proposes the cycle")
    must(submit(OP, [MEMBER], [create(T_CYCLE, {
        "governanceParty": E, "proposer": MEMBER, "gateId": st["gate_id"],
        "permitRefs": [refs["AB"], refs["CB"], refs["CA"]], "permits": [cids["AB"], cids["CB"], cids["CA"]],
        "salts": [{"_1": A, "_2": st["salts"]["A"]}, {"_1": B, "_2": st["salts"]["B"]}, {"_1": C, "_2": st["salts"]["C"]}],
        "deadline": deadline, "description": f"CompressRail compression cycle {st['gate_id']}: three permits, one net leg"})]),
        "proposal")
    p = poll(lambda: next((c for c in acs(OP, E, F_CYCLE) if c["createArgument"]["gateId"] == st["gate_id"]), None), "proposal")
    st["proposal_cid"], st["proposal_deadline"] = p["contractId"], deadline
    save(st)
    print(f"    proposal {p['contractId'][:16]}…  deadline {deadline}  signatory {p['signatories'][0].split('::')[0]}  "
          f"observer {[o.split('::')[0] for o in p['observers']]}")


def confirm():
    st = load()
    prop = st["proposal_cid"]
    say("Our member confirms (GovernanceRules_ConfirmAction)")
    mine = [c for c in confirmations(prop) if c["createArgument"]["confirmer"] == MEMBER]
    if mine:
        print("    already confirmed earlier: not creating a second confirmation")
    else:
        must(submit(OP, [MEMBER], [exercise(T_RULES, st["rules_cid"], "GovernanceRules_ConfirmAction",
                                            {"confirmer": MEMBER, "actionProposalCid": prop})], read_as=[E]),
             "confirmation")
    ours = poll(lambda: next((c for c in confirmations(prop) if c["createArgument"]["confirmer"] == MEMBER), None), "our confirmation")
    st["our_confirmation"] = ours["contractId"]
    print(f"    confirmation {ours['contractId'][:16]}…  expires {ours['createArgument']['expiresAt']}")
    ds = disclosed(st)
    results = {}

    def attempt(label, needle, act_as, cmd, read_as=(E,)):
        code, out = submit(OP, act_as, [cmd], read_as=read_as, disclosed=ds)
        text = json.dumps(out) if not isinstance(out, str) else out
        ok = code != 200 and needle in text
        results[label] = {"http": code, "rejected": code != 200, "reason_matches": needle in text, "detail": text[:400]}
        print(f"    {'PASS' if ok else 'FAIL'}  {label}: http {code}")
        return ok

    say("Execution with only our confirmation must be rejected")
    attempt("execute with one confirmation", "Enough confirmations to execute action", [MEMBER],
            exercise(T_RULES, st["rules_cid"], "GovernanceRules_ExecuteConfirmedAction",
                     {"executor": MEMBER, "actionProposalCid": prop, "confirmations": [ours["contractId"]]}))
    say("Bypass attempts must be rejected")
    attempt("our member exercises a permit directly", "DAML_AUTHORIZATION_ERROR", [MEMBER],
            exercise(T_PERMIT, st["permit_cids"]["AB"], "Permit_Execute", {}))
    attempt("our node submits as compressrail-exec alone", "NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT", [E],
            exercise(T_PERMIT, st["permit_cids"]["AB"], "Permit_Execute", {}), read_as=())
    say("Nothing changed")
    unchanged = len(permits_of_e(st)) == 3 and len(ds) == 3 and len(disclosed(st)) == 3
    print(f"    three permits and three trades still active: {unchanged}")
    st["confirm_results"], st["confirm_unchanged"] = results, unchanged
    save(st)


def status():
    st = load()
    cs = confirmations(st["proposal_cid"])
    print(f"    {len(cs)} confirmation(s) on {st['proposal_cid'][:16]}…")
    for c in cs:
        a = c["createArgument"]
        print(f"      {a['confirmer'].split('::')[0]:20} expires {a['expiresAt']}")


def execute():
    st = load()
    prop = st["proposal_cid"]
    margin = now() + timedelta(minutes=10)
    say("Re-check before execution")
    r = rules()
    check_rules(r)
    if r["contractId"] != st["rules_cid"]:
        raise RuntimeError("the rules contract changed")
    cs = confirmations(prop)
    confirmers = sorted(c["createArgument"]["confirmer"] for c in cs)
    if confirmers != sorted([MEMBER, BITSAFE_MEMBER]):
        raise RuntimeError(f"need exactly one confirmation from each member, have {[c.split('::')[0] for c in confirmers]}")
    for c in cs:
        if parse_time(c["createArgument"]["expiresAt"]) < margin:
            raise RuntimeError(f"a confirmation expires within 10 minutes: {c['createArgument']['expiresAt']}")
    if parse_time(st["proposal_deadline"]) < margin or parse_time(st["permit_deadline"]) < margin:
        raise RuntimeError("the proposal or a permit is too close to its deadline")
    if len(permits_of_e(st)) != 3:
        raise RuntimeError("not all three permits are active (a firm may have withdrawn)")
    print("    rules as agreed; two confirmations, one per member, valid; proposal and permits within their deadlines")
    st["topology_before_execute"] = topology()
    ds = disclosed(st)
    say("Execute (GovernanceRules_ExecuteConfirmedAction, both confirmations)")
    out = must(submit(OP, [MEMBER], [exercise(T_RULES, st["rules_cid"], "GovernanceRules_ExecuteConfirmedAction",
                                              {"executor": MEMBER, "actionProposalCid": prop,
                                               "confirmations": [c["contractId"] for c in cs]})],
                      read_as=[E], disclosed=ds), "execution")
    st["execute_response"] = out
    save(st)
    print(f"    update {str((out or {}).get('updateId', '?'))[:24]}…  offset {(out or {}).get('completionOffset', '?')}")
    A, C = st["parties"]["A"], st["parties"]["C"]
    run_refs = set(st["trade_refs"].values()) | {st["leg_ref"]}

    def settled():
        a = [c for c in acs(VAL, A, F_TRADE) if c["createArgument"]["tradeRef"] in run_refs]
        c_ = [c for c in acs(VAL, C, F_TRADE) if c["createArgument"]["tradeRef"] in run_refs]
        return (a, c_) if [x["createArgument"]["tradeRef"] for x in a] == [st["leg_ref"]] and not c_ else None
    a, _ = poll(settled, "settlement on our validator", tries=45)
    st["leg_cid"] = a[0]["contractId"]
    say("Settled")
    print(f"    A holds only the net leg (signatories {[s.split('::')[0][:14] for s in a[0]['signatories']]}); C holds nothing")
    print(f"    permits left for compressrail-exec: {len(permits_of_e(st))}; proposal active: "
          f"{any(c['contractId'] == prop for c in acs(OP, E, F_CYCLE))}; confirmations left: {len(confirmations(prop))}")
    st["chain_audit"] = dm("GET", f"/governance/chain-audit?party_id={E}&limit=30&refresh=true")
    st["executed_at"] = iso(now())
    save(st)


def classify(events, st):
    """Map this run's events to pairs: AB, CB, CA (and the leg, AB); anything governance-related is 'governance'."""
    by_ref = {v: k for k, v in st["trade_refs"].items()}
    by_ref.update({v: k for k, v in st["permit_refs"].items()})
    by_ref[st["leg_ref"]] = "AB"
    cid_pair = {}
    for k, v in (st.get("trade_cids") or {}).items():
        cid_pair[v] = k
    for k, v in (st.get("permit_cids") or {}).items():
        cid_pair[v] = k
    pairs, governance, entities = set(), set(), set()
    for kind, ent, choice, arg, cid in events:
        entities.add(ent)
        if ent in GOV_ENTITIES:
            governance.add(ent)
            continue
        ref = arg.get("tradeRef") or arg.get("permitRef") or (arg.get("permit") or {}).get("permitRef")
        pair = by_ref.get(ref) or cid_pair.get(cid)
        if pair:
            pairs.add(pair)
            if kind == "Created" and cid:
                cid_pair[cid] = pair
    return sorted(pairs), sorted(governance), sorted(entities)


def tree(node, party, begin):
    end = ledger_end(node)
    out = ledger(node, "/v2/updates", {"beginExclusive": begin, "endInclusive": end, "updateFormat": {"includeTransactions": {
        "eventFormat": {"filtersByParty": {party: {"cumulative": [
            {"identifierFilter": {"WildcardFilter": {"value": {"includeCreatedEventBlob": False}}}}]}}, "verbose": True},
        "transactionShape": "TRANSACTION_SHAPE_LEDGER_EFFECTS"}}}) or []
    evs = []
    for it in out:
        tx = ((it.get("update") or {}).get("Transaction") or {}).get("value") or {}
        for ev in tx.get("events", []):
            for kind, v in ev.items():
                evs.append((kind.replace("Event", ""), v.get("templateId", "?").split(":")[-1], v.get("choice", ""),
                            v.get("createArgument") or {}, v.get("contractId")))
    return evs


def evidence():
    st = load()
    expected = {"A": ["AB", "CA"], "C": ["CA", "CB"]}
    report = {}
    say("What each party received (ledger-effects, this run)")
    for name, node, party, begin in (("A", VAL, st["parties"]["A"], st["offsets"]["val_begin"]),
                                     ("C", VAL, st["parties"]["C"], st["offsets"]["val_begin"]),
                                     ("compressrail-exec (operator node)", OP, E, st["offsets"]["op_begin"])):
        evs = tree(node, party, begin)
        pairs, gov, ents = classify(evs, st)
        foreign = sorted(set(pairs) - set(expected[name])) if name in expected else []
        report[name] = {"events": len(evs), "pairs": pairs, "foreign_pairs": foreign, "governance": gov, "templates": ents}
        print(f"    {name:34} pairs {pairs}  foreign {foreign}  governance {gov}")
    st["evidence"] = report
    st["topology_after"] = topology()
    st["rules_after"] = rules()["createArgument"]
    save(st)
    print("\n" + st["topology_after"])


if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else ""
    phases = {"setup": setup, "permits": permits, "check": check, "propose": propose, "confirm": confirm,
              "status": status, "execute": execute, "evidence": evidence}
    if phase not in phases:
        sys.exit(f"usage: cycle.py {{{'|'.join(phases)}}}")
    phases[phase]()
