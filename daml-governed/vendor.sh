#!/usr/bin/env bash
# Fetches the Decentralization Manager governance Daml packages at a pinned commit
# and builds them locally, so `daml-governed` can depend on them in tests.
#
# Pinned: DLC-link/decentralization-manager v1.12.0 (Apache-2.0).
# The sources are built with this project's SDK, so the resulting package ids
# differ from the DARs a Decentralization Manager v1.12.0 node distributes. That is
# fine for Daml Script tests; a DevNet deployment must use the node's own DARs.
set -euo pipefail

COMMIT="4d650edbbf851852311a4921af8f5df608450a6b" # tag v1.12.0
REPO="https://raw.githubusercontent.com/DLC-link/decentralization-manager/${COMMIT}"
SDK="3.5.1"
HERE="$(cd "$(dirname "$0")" && pwd)"
VENDOR="${HERE}/.vendor"
DPM="${DPM:-$HOME/.dpm/bin/dpm}"

fetch() { # fetch <repo-path>
  mkdir -p "${VENDOR}/$(dirname "$1")"
  curl -fsSL -m 60 -o "${VENDOR}/$1" "${REPO}/$1"
}

echo "→ fetching governance packages at ${COMMIT:0:12}"
fetch daml/governance-action-v1/daml.yaml
fetch daml/governance-action-v1/daml/Governance/Action.daml
fetch daml/governance-core/daml.yaml
for m in Confirmation ExecutionResult GenericVote Rules; do
  fetch "daml/governance-core/daml/Governance/${m}.daml"
done
fetch daml/dars/splice-util-0.1.4.dar

echo "→ building with SDK ${SDK}"
for pkg in governance-action-v1 governance-core; do
  sed -i -E "s/^sdk-version: .*/sdk-version: ${SDK}/" "${VENDOR}/daml/${pkg}/daml.yaml"
  (cd "${VENDOR}/daml/${pkg}" && "${DPM}" build >/dev/null)
done
ls "${VENDOR}"/daml/governance-*/.daml/dist/*.dar
