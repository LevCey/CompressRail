#!/usr/bin/env bash
# Reads E's topology back from a participant's Admin API and prints every
# threshold that governs it: the hosting confirmation threshold and hosts
# (PartyToParticipant), the external signing-key threshold, and the namespace
# threshold (DecentralizedNamespaceDefinition). Needs grpcurl.
#
#   topology.sh <admin-host:port> <party-id> <synchronizer-id>
set -euo pipefail
ADMIN="$1" PARTY="$2" SYNC="$3"
NS="${PARTY#*::}"
SVC=com.digitalasset.canton.topology.admin.v30.TopologyManagerReadService
base="\"base_query\":{\"store\":{\"synchronizer\":{\"id\":\"$SYNC\"}},\"head_state\":{},\"filter_signed_key\":\"\"}"

grpcurl -plaintext -d "{$base,\"filter_party\":\"$PARTY\"}" "$ADMIN" "$SVC/ListPartyToParticipant" | python3 -c '
import json, sys
for r in json.load(sys.stdin).get("results", []):
    m = r.get("item", {})
    print("PartyToParticipant  confirmation threshold:", m.get("threshold"))
    for p in m.get("participants", []):
        print("  host:", p.get("participantUid"), p.get("permission"))
    k = m.get("partySigningKeys") or {}
    print("Party signing keys  count:", len(k.get("keys", [])), " threshold:", k.get("threshold"))
'
grpcurl -plaintext -d "{$base,\"filter_namespace\":\"$NS\"}" "$ADMIN" "$SVC/ListDecentralizedNamespaceDefinition" | python3 -c '
import json, sys
for r in json.load(sys.stdin).get("results", []):
    m = r.get("item", {})
    print("Decentralized namespace  owners:", len(m.get("owners", [])), " threshold:", m.get("threshold"))
'
