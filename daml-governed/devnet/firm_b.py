#!/usr/bin/env python3
"""Firm B's side of the DevNet governed compression cycle, on firm B's own participant.

firm B is hosted on a different participant from firms A and C, so it accepts its trades and permits there,
with its own credentials:

  firm_b.py accept-trades    accept this run's two trade proposals (A–B, C–B) after checking them
  firm_b.py accept-permits   accept this run's two permit proposals (A–B, C–B) after checking them
  firm_b.py evidence         what firm B received (ledger-effects) since accept-trades, and what it holds now

Environment:
  CR_FIRM_LEDGER_URL   JSON Ledger API of firm B's participant
  CR_FIRM_TOKEN        access token for that API (obtain and refresh it outside this script)
  CR_FIRM_USER_ID      ledger API user id
  CR_RUN_FILE          the `<run>-b.json` file written by `cycle.py setup` (party ids and opaque refs only)
  CR_FIRM_OFFSET_FILE  where the starting offset is kept for `evidence` (default: <run file>.offset)

Before accepting, every proposal is checked against the run file: package id, counterparty, proposer,
executor, gate id, one trade to tear up, and new legs only between the same two firms.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

API = os.environ["CR_FIRM_LEDGER_URL"].rstrip("/")
TOKEN = os.environ["CR_FIRM_TOKEN"]
USER = os.environ["CR_FIRM_USER_ID"]
RUN_FILE = os.environ["CR_RUN_FILE"]
OFFSET_FILE = os.environ.get("CR_FIRM_OFFSET_FILE", RUN_FILE + ".offset")

run = json.load(open(RUN_FILE))
B, E, PKG = run["firm_b"], run["executor"], run["cr_pkg"]
# Filters and commands use the package name (some participants accept only that form); the pinned
# package id is checked on every contract before acting on it.
T_TPROP = "#compressrail:CompressRail.Trade:TradeProposal"
T_PPROP = "#compressrail:CompressRail.Gate:PermitProposal"
T_TRADE = "#compressrail:CompressRail.Trade:BilateralTrade"
GOV_ENTITIES = {"CycleExecutionProposal", "GovernanceRules", "GovernanceConfirmation", "GovernanceExecutionResult"}


def http(method, path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


def end():
    return http("GET", "/v2/state/ledger-end")[1]["offset"]


def acs(template):
    code, out = http("POST", "/v2/state/active-contracts", {"activeAtOffset": end(), "eventFormat": {"filtersByParty": {B: {
        "cumulative": [{"identifierFilter": {"TemplateFilter": {"value": {"templateId": template,
                                                                          "includeCreatedEventBlob": False}}}}]}}, "verbose": True}})
    if code != 200:
        sys.exit(f"  read failed: {code} {out}")
    return [it["contractEntry"]["JsActiveContract"]["createdEvent"] for it in out
            if (it.get("contractEntry") or {}).get("JsActiveContract")]


def accept(template, cid, choice):
    code, out = http("POST", "/v2/commands/submit-and-wait", {"actAs": [B], "userId": USER, "commandId": str(uuid.uuid4()),
        "commands": [{"ExerciseCommand": {"templateId": template, "contractId": cid, "choice": choice, "choiceArgument": {}}}]})
    print(f"    {choice}: http {code}")
    if code != 200:
        sys.exit(f"  {out}")


def wait_for(fn, want, what):
    for _ in range(30):
        got = fn()
        if len(got) >= want:
            return got
        time.sleep(2)
    sys.exit(f"  only {len(fn())} of {want} {what} visible yet")


def accept_trades():
    if not os.path.exists(OFFSET_FILE):
        with open(OFFSET_FILE, "w") as f:
            f.write(str(end()))
    refs = {run["trade_refs"]["AB"]: "A–B", run["trade_refs"]["CB"]: "C–B"}
    print("→ checking and accepting this run's trade proposals")
    found = wait_for(lambda: [c for c in acs(T_TPROP) if c["createArgument"]["tradeRef"] in refs], 2, "trade proposals")
    for c in found:
        a = c["createArgument"]
        if not c["templateId"].startswith(PKG) or a["counterparty"] != B or a["proposer"] not in run["proposers"]:
            sys.exit("  a proposal does not match this run — not accepting")
        print(f"  {refs[a['tradeRef']]}: from {a['proposer'].split('::')[0]}")
        accept(T_TPROP, c["contractId"], "Accept")


def accept_permits():
    refs = {run["permit_refs"]["AB"]: "A–B", run["permit_refs"]["CB"]: "C–B"}
    print("→ checking and accepting this run's permit proposals")
    found = wait_for(lambda: [c for c in acs(T_PPROP) if c["createArgument"]["permit"]["gateId"] == run["gate_id"]], 2,
                     "permit proposals")
    for c in found:
        p = c["createArgument"]["permit"]
        ok = (c["templateId"].startswith(PKG) and p["cptyB"] == B and p["executor"] == E and p["permitRef"] in refs
              and p["cptyA"] in run["proposers"] and len(p["teardown"]) == 1
              and all({leg["cptyA"], leg["cptyB"]} == {p["cptyA"], B} for leg in p["legs"]))
        if not ok:
            sys.exit("  a permit proposal does not match this run — not accepting")
        print(f"  {refs[p['permitRef']]}: executor {E.split('::')[0]}, one trade to tear up, {len(p['legs'])} new leg(s), "
              f"deadline {p['deadline']}")
        accept(T_PPROP, c["contractId"], "PermitProposal_Accept")


def evidence():
    begin = int(open(OFFSET_FILE).read())
    code, out = http("POST", "/v2/updates", {"beginExclusive": begin, "endInclusive": end(), "updateFormat": {
        "includeTransactions": {"eventFormat": {"filtersByParty": {B: {"cumulative": [
            {"identifierFilter": {"WildcardFilter": {"value": {"includeCreatedEventBlob": False}}}}]}}, "verbose": True},
            "transactionShape": "TRANSACTION_SHAPE_LEDGER_EFFECTS"}}})
    if code != 200:
        sys.exit(f"  read failed: {code} {out}")
    by_ref = {v: k for k, v in run["trade_refs"].items()}
    by_ref.update({v: k for k, v in run["permit_refs"].items()})
    by_ref[run["leg_ref"]] = "AB"
    pairs, gov, cid_pair, n = set(), set(), {}, 0
    for it in out:
        tx = ((it.get("update") or {}).get("Transaction") or {}).get("value") or {}
        for ev in tx.get("events", []):
            for _kind, v in ev.items():
                n += 1
                ent = v.get("templateId", "?").split(":")[-1]
                if ent in GOV_ENTITIES:
                    gov.add(ent)
                    continue
                a = v.get("createArgument") or {}
                ref = a.get("tradeRef") or a.get("permitRef") or (a.get("permit") or {}).get("permitRef")
                pair = by_ref.get(ref) or cid_pair.get(v.get("contractId"))
                if pair:
                    pairs.add(pair)
                    cid_pair[v.get("contractId")] = pair
    held = [c["createArgument"]["tradeRef"] for c in acs(T_TRADE) if c["createArgument"]["tradeRef"] in by_ref]
    print("→ firm B, ledger-effects since accept-trades")
    print(f"  events {n}  pairs {sorted(pairs)}  foreign {sorted(pairs - {'AB', 'CB'})}  governance {sorted(gov)}")
    print(f"  holds now: {['net leg' if r == run['leg_ref'] else by_ref[r] for r in held]}")


if __name__ == "__main__":
    phases = {"accept-trades": accept_trades, "accept-permits": accept_permits, "evidence": evidence}
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd not in phases:
        sys.exit(f"usage: firm_b.py {{{'|'.join(phases)}}}")
    phases[cmd]()
