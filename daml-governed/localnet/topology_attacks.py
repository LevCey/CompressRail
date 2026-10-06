#!/usr/bin/env python3
"""One owner of E tries to change E's control on its own, on the LocalNet sandbox.

Run after rehearse.py. Node 1 (one of E's two owners) submits each change with
only its own signature (`must_fully_authorize = false`). With a 2-of-2
decentralized namespace each must stay a pending proposal: the effective
topology must be unchanged. Also checks that a governance self-action (lowering
GovernanceRules' threshold) cannot execute with one confirmation, and that a
Decentralization Manager node keeps its identity across a restart.

Usage: topology_attacks.py <decentralization-manager-checkout>
Needs grpcurl. LocalNet only.
"""
import copy
import json
import os
import subprocess
import sys
import time
import urllib.request
import uuid

REPO = sys.argv[1]
TOKEN = next(l.split("=", 1)[1].strip().strip('"') for l in open(f"{REPO}/hackathon/localnet.sh")
             if l.startswith("LOCALNET_CANTON_TOKEN="))
STATE = dict(l.strip().split("=", 1) for l in open(f"{REPO}/hackathon/.state") if "=" in l)
ADMIN1 = "localhost:3902"
READ = "com.digitalasset.canton.topology.admin.v30.TopologyManagerReadService"
WRITE = "com.digitalasset.canton.topology.admin.v30.TopologyManagerWriteService"
RESULTS = {}


def grpc(addr, method, body):
    p = subprocess.run(["grpcurl", "-plaintext", "-d", json.dumps(body), addr, method],
                       capture_output=True, text=True)
    return p.returncode, (p.stdout if p.returncode == 0 else p.stderr)


def get(port, path):
    return json.load(urllib.request.urlopen(f"http://localhost:{port}{path}", timeout=60))


def ledger(port, path, body=None):
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=json.dumps(body).encode() if body else None,
                                 method="POST" if body else "GET",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def say(m):
    print(f"\n==> {m}", flush=True)


def main():
    e = next(p["party_id"] for p in get(8081, "/decentralized-parties")["parties"] if p["party_id"].startswith("cr-exec::"))
    ns = e.split("::")[1]
    sync = ledger(3975, "/v2/state/connected-synchronizers")[1]["connectedSynchronizers"][0]["synchronizerId"]
    store = {"synchronizer": {"id": sync}}
    me = next(p for p in get(8081, "/decentralized-parties")["parties"] if p["party_id"] == e)
    my_key = me["my_owner_key"]
    print(f"    E {e[:24]}…  node 1 owner key {my_key[:16]}…")

    def query(kind, proposals):
        flt = {"filter_party": e} if kind == "PartyToParticipant" else {"filter_namespace": ns}
        code, out = grpc(ADMIN1, f"{READ}/List{kind}", {"base_query": {"store": store, "proposals": proposals,
                                                         "head_state": {}, "filter_signed_key": ""}, **flt})
        if code != 0:
            raise RuntimeError(out)
        return json.loads(out).get("results", [])

    def effective(kind):
        r = query(kind, False)
        return r[0]["item"], int(r[0]["context"]["serial"])

    def attempt(label, kind, mapping_key, mutate):
        item, serial = effective(kind)
        new = mutate(copy.deepcopy(item))
        code, out = grpc(ADMIN1, f"{WRITE}/Authorize", {
            "proposal": {"change": "TOPOLOGY_CHANGE_OP_ADD_REPLACE", "serial": serial + 1, "mapping": {mapping_key: new}},
            "must_fully_authorize": False, "signed_by": [my_key], "store": store})
        time.sleep(8)
        after, after_serial = effective(kind)
        unchanged = after == item and after_serial == serial
        pending = [r for r in query(kind, True) if int(r["context"]["serial"]) == serial + 1]
        signers = pending[0]["context"].get("signedByFingerprints", []) if pending else []
        RESULTS[label] = {"authorize_ok": code == 0, "authorize_detail": out[:300] if code else "",
                          "effective_unchanged": unchanged, "pending_proposal": bool(pending), "pending_signers": signers}
        verdict = "PASS" if unchanged else "FAIL"
        print(f"    {verdict}  {label}: effective unchanged={unchanged}; "
              + (f"pending proposal signed by {len(signers)} key(s)" if pending
                 else f"no pending proposal (authorize {'ok' if code == 0 else 'refused: ' + out.strip()[:160]})"))

    say("Node 1 alone tries to change E's topology")
    if os.environ.get("SKIP_TOPOLOGY") == "1":
        print("    skipped (SKIP_TOPOLOGY=1)")
    else:
      attempt("lower the hosting confirmation threshold to 1", "PartyToParticipant", "party_to_participant",
            lambda m: {**m, "threshold": 1})
      pid1 = get(8081, "/node-config")["node"]["participant_id"]
      attempt("remove the other host and set threshold 1", "PartyToParticipant", "party_to_participant",
            lambda m: {**m, "threshold": 1, "participants": [p for p in m["participants"] if p["participantUid"] == pid1]})
      attempt("lower the namespace threshold to 1", "DecentralizedNamespaceDefinition",
            "decentralized_namespace_definition", lambda m: {**m, "threshold": 1})

    say("One member tries to lower GovernanceRules' threshold with one confirmation")
    m1 = STATE["MEMBER_1"]
    rules = get(8081, f"/governance/state?party_id={e}")["state"]["contract_id"]
    tid = "#governance-core-v1:Governance.Rules:GovernanceRules"
    action = {"tag": "SelfAction_SetThreshold", "value": {"updatedThreshold": "1"}}
    def submit(cmd):
        return ledger(3975, "/v2/commands/submit-and-wait", {"commands": [cmd], "actAs": [m1], "readAs": [e],
                                                              "userId": "ledger-api-user", "commandId": str(uuid.uuid4())})
    code, out = submit({"ExerciseCommand": {"templateId": tid, "contractId": rules,
                                            "choice": "GovernanceRules_ConfirmGovernanceAction",
                                            "choiceArgument": {"confirmer": m1, "action": action}}})
    if code != 200:
        raise RuntimeError(f"self-confirmation failed: {out}")
    off = ledger(3975, "/v2/state/ledger-end")[1]["offset"]
    acs = ledger(3975, "/v2/state/active-contracts", {"activeAtOffset": off, "eventFormat": {"filtersByParty": {m1: {
        "cumulative": [{"identifierFilter": {"TemplateFilter": {"value": {
            "templateId": "#governance-core-v1:Governance.Rules:GovernanceSelfConfirmation",
            "includeCreatedEventBlob": False}}}}]}}, "verbose": True}})[1]
    # Only the confirmation just created: earlier runs may have left m1 confirmations behind, and two
    # from the same member would be rejected for a different reason (duplicate confirmer).
    created = [it["contractEntry"]["JsActiveContract"]["createdEvent"] for it in acs
               if it.get("contractEntry", {}).get("JsActiveContract")]
    confs = [max(created, key=lambda ev: int(ev.get("offset", 0)))["contractId"]]
    code, out = submit({"ExerciseCommand": {"templateId": tid, "contractId": rules,
                                            "choice": "GovernanceRules_ExecuteGovernanceAction",
                                            "choiceArgument": {"executor": m1, "action": action, "confirmations": confs}}})
    text = out if isinstance(out, str) else json.dumps(out)
    rejected = code != 200 and "confirmations to execute action" in text
    RESULTS["governance threshold change with one confirmation"] = {"http": code, "detail": text[:300]}
    print(f"    {'PASS' if rejected else 'FAIL'}  rejected: http {code}  {text[text.find('requirement'):][:90] if 'requirement' in text else text[:120]}")

    say("Restart of a Decentralization Manager node keeps its identity")
    def noise_key_hash():
        mp = subprocess.run(["docker", "volume", "inspect", "decman-hackathon_decman-1-data", "-f", "{{.Mountpoint}}"],
                            capture_output=True, text=True, check=True).stdout.strip()
        return subprocess.run(["sha256sum", f"{mp}/noise.key"], capture_output=True, text=True, check=True).stdout[:16]
    key_before = noise_key_hash()
    before = get(8081, "/node-config")["node"]
    subprocess.run(["docker", "restart", "decman-1"], check=True, capture_output=True)
    def up():
        try:
            return get(8081, "/healthz") is not None or True
        except Exception:
            return False
    for _ in range(60):
        if up():
            break
        time.sleep(2)
    time.sleep(5)
    after = get(8081, "/node-config")["node"]
    still_e = any(p["party_id"] == e for p in get(8081, "/decentralized-parties")["parties"])
    mesh = get(8081, "/participants-status")["statuses"]
    same = {"participant_id": before["participant_id"] == after["participant_id"],
            "public_address": before["public_address"] == after["public_address"],
            "noise_key": key_before == noise_key_hash()}
    connected = all(s["status"] in ("Connected", "CurrentNode") for s in mesh)
    RESULTS["restart"] = {"identity_fields_unchanged": same, "E_still_listed": still_e, "mesh_connected": connected}
    print(f"    identity fields unchanged: {same}  E listed: {still_e}  mesh connected: {connected}")

    json.dump(RESULTS, open(f"{os.environ.get('CR_OUT_DIR', '.')}/topology-attacks-{int(time.time())}.json", "w"), indent=2)
    say("Results written")


if __name__ == "__main__":
    main()
