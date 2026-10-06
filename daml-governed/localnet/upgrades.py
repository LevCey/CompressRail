#!/usr/bin/env python3
"""Upgrade controls on the LocalNet sandbox. Run after rehearse.py.

Uses the rehearsal-only successors from build_upgrades.sh:
  compressrail-governed 0.0.9   executeImpl runs only the first permit
  compressrail 0.0.10           Permit_Execute creates no replacement leg
  compressrail-governed 0.0.10  unchanged logic, linked to compressrail 0.0.10

  A1  stock GovernanceRules: a cycle approved under 0.0.1 is executed after
      0.0.9 is vetted on E's hosts. Expected: the successor's code runs and a
      firm is left partly compressed (the upgrade path of the quorum assumption).
  A2  CompressionRules (separate package, admits governed 0.0.1 only): the same
      sequence is rejected at execution; with 0.0.1 selected it executes fully.
  B   an action successor (governed 0.0.10) linked to a permit successor
      (compressrail 0.0.10), vetted on E's hosts but not on the firms' node.
      Expected: execution selecting them is refused; once the firms' node
      vets the permit successor, it runs. Firm-side vetting is the control.

Usage: upgrades.py <decentralization-manager-checkout> <dir-with-dars> <dir-with-upgrade-dars>
"""
import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

UPG = sys.argv[3]
sys.argv = sys.argv[:3]
import rehearse as r          # noqa: E402
import failures as f          # noqa: E402

T_CCONF = "#compressrail-rules:CompressRail.RestrictedRules:CompressionConfirmation"
T_CRULES = "#compressrail-rules:CompressRail.RestrictedRules:CompressionRules"


def pkg_id(path):
    import zipfile
    out = zipfile.ZipFile(path).read("META-INF/MANIFEST.MF").decode()
    main = next(l.split(":", 1)[1].strip() for l in out.replace("\n ", "").splitlines() if l.startswith("Main-Dalf:"))
    return main.rsplit("-", 1)[-1].removesuffix(".dalf")


def upload(nodes, path):
    for n in nodes:
        r.ok("POST", f"http://localhost:{r.LEDGER[n]}/v2/packages", raw=open(path, "rb").read(), token=r.TOKEN,
             ctype="application/octet-stream")


def submit_pref(node, act_as, commands, read_as=(), disclosed=(), pref=()):
    body = {"commands": commands, "actAs": list(act_as), "readAs": list(read_as), "userId": r.USER,
            "commandId": str(uuid.uuid4())}
    if disclosed:
        body["disclosedContracts"] = list(disclosed)
    if pref:
        body["packageIdSelectionPreference"] = list(pref)
    return r.http("POST", f"http://localhost:{r.LEDGER[node]}/v2/commands/submit-and-wait", body, token=r.TOKEN)


def held(firms):
    return {k: sorted(ev["createArgument"]["tradeRef"].split("-")[0] for ev in r.acs(3, p, r.T_TRADE))
            for k, p in firms.items()}


def propose_v1(e, m1, gate_id, refs, permits, salt, deadline, gov1):
    tid = f"{gov1}:CompressRail.Governed:CycleExecutionProposal"
    r.must_submit(1, [m1], [r.create(tid, {
        "governanceParty": e, "proposer": m1, "gateId": gate_id, "permitRefs": refs, "permits": permits,
        "salts": [{"_1": p, "_2": v} for p, v in salt.items()], "deadline": deadline,
        "description": f"compression cycle {gate_id}"})])
    return r.find(1, m1, r.T_CYCLE, lambda arg: arg["gateId"] == gate_id)["contractId"]


def approve_stock_v1(e, m1, m2, stock_rules, gate_id, permit, salt, dl, gov1):
    prop = propose_v1(e, m1, gate_id, ["rAB", "rBC", "rCA"], [permit[q] for q in ("rAB", "rBC", "rCA")], salt, dl, gov1)
    confs = []
    for node, m in ((1, m1), (2, m2)):
        r.find(node, e, r.T_CYCLE, lambda arg: arg["gateId"] == gate_id)
        r.must_submit(node, [m], [r.exercise(r.T_RULES, stock_rules, "GovernanceRules_ConfirmAction",
                                             {"confirmer": m, "actionProposalCid": prop})], read_as=[e])
        confs.append(r.find(node, e, f.T_CONF, lambda arg, q=m: arg["actionProposalCid"] == prop and arg["confirmer"] == q)["contractId"])
    return prop, confs


def deadline():
    return (datetime.now(timezone.utc) + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def main():
    s = r.state()
    m1, m2 = s["MEMBER_1"], s["MEMBER_2"]
    e = next(p["party_id"] for p in r.dm("GET", 1, "/decentralized-parties")["parties"]
             if p["party_id"].startswith(r.PREFIX + "::"))
    pid = {i: r.dm("GET", i, "/node-config")["node"]["participant_id"] for i in (1, 2)}
    gov1 = pkg_id(f"{r.DARS}/compressrail-governed-0.0.1.dar")
    gov9 = pkg_id(f"{UPG}/compressrail-governed-0.0.9.dar")
    cr3 = pkg_id(f"{r.DARS}/compressrail-0.0.3.dar")
    cr9 = pkg_id(f"{UPG}/compressrail-0.0.9.dar")
    print(f"    governed 0.0.1 {gov1[:12]}…  0.0.9 {gov9[:12]}…   compressrail 0.0.3 {cr3[:12]}…  0.0.9 {cr9[:12]}…")
    stock_rules = r.dm("GET", 1, f"/governance/state?party_id={e}")["state"]["contract_id"]

    r.say("Restricted rules for E: compressrail-rules distributed, CompressionRules deployed through the tool")
    if not s.get("CR_RULES_DONE"):
        files = [{"filename": "compressrail-rules-0.0.1.dar",
                  "data": base64.b64encode(open(f"{r.DARS}/compressrail-rules-0.0.1.dar", "rb").read()).decode()}]
        r.dm("POST", 1, "/dars/distribute", {"dar_files": files, "peer_ids": [pid[2]]})
        r.accept_invitation(2, "Dars")
        r.wait_workflow(1, "/dars/distribute/status", "rules DAR distribution")
        upload([1], f"{r.DARS}/compressrail-rules-0.0.1.dar")
        r.dm("POST", 1, "/contracts", {
            "decentralized_party_id": e, "participant_ids": [pid[1], pid[2]], "participant_parties": [m1, m2],
            "operator_party": m1,
            "contracts": [{"id": "compression-rules", "name": "CompressionRules", "package_id": "#compressrail-rules",
                           "module_name": "CompressRail.RestrictedRules", "entity_name": "CompressionRules",
                           "fields": [{"type": "decentralized_party"}, {"type": "party_set", "parties": [m1, m2]},
                                      {"type": "int64", "value": 2}, {"type": "rel_time", "microseconds": 1800000000}]}]})
        r.accept_invitation(2, "Contracts")
        r.wait_workflow(1, "/contracts/status", "CompressionRules deployment")
        with open(r.STATE, "a") as fh:
            fh.write("CR_RULES_DONE=1\n")
    crules = r.find(1, e, T_CRULES, lambda arg: True)["contractId"]
    print(f"    CompressionRules {crules[:16]}…")

    import os
    skip_a = os.environ.get("SKIP_A") == "1"
    # ---------- A1: stock rules, action upgraded after approval ----------
    r.say("A1  stock rules: approve a cycle under governed 0.0.1, then vet 0.0.9 on E's hosts and execute")
    if skip_a:
        print("    skipped (SKIP_A=1)")
    if not skip_a:
        run = uuid.uuid4().hex[:6]
        dl = deadline()
        firms, salt, gate_id, permit, disclosed = f.ring(e, run, dl)
        prop, confs = approve_stock_v1(e, m1, m2, stock_rules, gate_id, permit, salt, dl, gov1)
        print("    both members confirmed the full package (governed 0.0.1)")
        upload([1, 2], f"{UPG}/compressrail-governed-0.0.9.dar")
        print("    governed 0.0.9 uploaded and vetted on nodes 1 and 2")
        code, out = r.submit(2, [m2], [r.exercise(r.T_RULES, stock_rules, "GovernanceRules_ExecuteConfirmedAction",
                                                  {"executor": m2, "actionProposalCid": prop, "confirmations": confs})],
                             read_as=[e], disclosed=disclosed)
        after = held(firms)
        partial = code == 200 and after["A"] == ["n1", "t3"]
        r.RESULTS["A1 stock rules execute the upgraded action"] = {"http": code, "held_after": after,
                                                                    "partial_compression": partial, "detail": str(out)[:300]}
        print(f"    {'OBSERVED' if partial else 'NOT OBSERVED'}  default selection ran 0.0.9: http {code}, held after {after}")

    # ---------- A2: restricted rules ----------
    def restricted(label, exec_pref, expect_ok):
        run = uuid.uuid4().hex[:6]
        dl = deadline()
        firms, salt, gate_id, permit, disclosed = f.ring(e, run, dl)
        prop = propose_v1(e, m1, gate_id, ["rAB", "rBC", "rCA"], [permit[q] for q in ("rAB", "rBC", "rCA")], salt, dl, gov1)
        confs = []
        for node, m in ((1, m1), (2, m2)):
            r.find(node, e, r.T_CYCLE, lambda arg: arg["gateId"] == gate_id)
            code, out = submit_pref(node, [m], [r.exercise(T_CRULES, crules, "CompressionRules_Confirm",
                                                           {"confirmer": m, "actionProposalCid": prop})],
                                    read_as=[e], pref=[gov1])
            if code != 200:
                raise RuntimeError(f"confirm failed: {str(out)[:400]}")
            confs.append(r.find(node, e, T_CCONF, lambda arg, q=m: arg["actionProposalCid"] == prop and arg["confirmer"] == q)["contractId"])
        code, out = submit_pref(2, [m2], [r.exercise(T_CRULES, crules, "CompressionRules_Execute",
                                                     {"executor": m2, "actionProposalCid": prop, "confirmations": confs})],
                                read_as=[e], disclosed=disclosed, pref=exec_pref)
        after = held(firms)
        if expect_ok:
            good = code == 200 and after == {"A": ["n1"], "B": ["n1"], "C": []}
            r.RESULTS[label] = {"http": code, "held_after": after, "detail": str(out)[:300]}
            print(f"    {'PASS' if good else 'FAIL'}  {label}: http {code}, held after {after}")
        else:
            good = r.expect_rejection(label, code, out, "Action implementation not admitted", "Daml (exact-version allowlist)")
            unchanged = after == {"A": ["t1", "t3"], "B": ["t1", "t2"], "C": ["t2", "t3"]}
            r.RESULTS[label]["state_unchanged"] = unchanged
            print(f"    every firm still holds its two original trades: {unchanged}")
            good = good and unchanged
        return good

    r.say("A2  restricted rules: the same approval, executed with 0.0.9 selected (default and explicit)")
    a2 = [] if skip_a else [restricted("A2 restricted rules reject the upgraded action (default selection)", [], False),
          restricted("A2 restricted rules reject the upgraded action (0.0.9 selected)", [gov9], False),
          restricted("A2 restricted rules execute the admitted action (0.0.1 selected)", [gov1], True)]

    # ---------- B: permit upgraded without the firms' vetting ----------
    # A selection preference alone does not swap the permit code: the action reaches Permit_Execute
    # through executePackage, a function call that is statically linked to the compressrail version the
    # action was compiled against (observed in an earlier run: preferring compressrail 0.0.9 still ran
    # 0.0.3's choice). So the attack is an action successor linked to a permit successor.
    gov10 = pkg_id(f"{UPG}/compressrail-governed-0.0.10.dar")
    cr10 = pkg_id(f"{UPG}/compressrail-0.0.10.dar")

    def leg_b(label, expect_refused):
        run = uuid.uuid4().hex[:6]
        dl = deadline()
        firms, salt, gate_id, permit, disclosed = f.ring(e, run, dl)
        prop, confs = approve_stock_v1(e, m1, m2, stock_rules, gate_id, permit, salt, dl, gov1)
        cmd = [r.exercise(r.T_RULES, stock_rules, "GovernanceRules_ExecuteConfirmedAction",
                          {"executor": m2, "actionProposalCid": prop, "confirmations": confs})]
        code, out = submit_pref(2, [m2], cmd, read_as=[e], disclosed=disclosed, pref=[gov10, cr10])
        after = held(firms)
        ran = ("none" if after == {"A": ["t1", "t3"], "B": ["t1", "t2"], "C": ["t2", "t3"]} else
               "0.0.3 (approved)" if after == {"A": ["n1"], "B": ["n1"], "C": []} else
               "0.0.10 (successor)" if after == {"A": [], "B": [], "C": []} else "unexpected")
        ok_ = (code != 200 and ran == "none") if expect_refused else (code == 200 and ran.startswith("0.0.10"))
        r.RESULTS[label] = {"http": code, "held_after": after, "permit_code_that_ran": ran, "detail": str(out)[:400]}
        print(f"    {'PASS' if ok_ else 'FAIL'}  {label}: http {code}, permit code that ran: {ran}")
        if code != 200:
            print(f"      {str(out)[:240]}")
        return ok_

    r.say("B   governed 0.0.10 + compressrail 0.0.10 vetted on E's hosts only; execution selects them")
    upload([1, 2], f"{UPG}/compressrail-0.0.10.dar")
    upload([1, 2], f"{UPG}/compressrail-governed-0.0.10.dar")
    b = [leg_b("B1 the firms' node has not vetted the permit successor", True)]
    upload([3], f"{UPG}/compressrail-0.0.10.dar")
    print("    the firms' node now vets compressrail 0.0.10")
    b.append(leg_b("B2 once the firms' node vets it, the successor runs", False))

    out_path = f"{os.environ.get('CR_OUT_DIR', '.')}/upgrades-{int(time.time())}.json"
    json.dump(r.RESULTS, open(out_path, "w"), indent=2)
    r.say(f"Results written to {out_path}")


if __name__ == "__main__":
    main()
