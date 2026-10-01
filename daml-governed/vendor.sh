#!/usr/bin/env bash
# Fetches the released Decentralization Manager governance DARs at a pinned commit,
# so `daml-governed` builds against the exact packages a Decentralization Manager
# node distributes (same package ids), and checks their SHA-256.
#
# Pinned: DLC-link/decentralization-manager v1.12.0 (Apache-2.0), `releases/v1/`.
set -euo pipefail

COMMIT="4d650edbbf851852311a4921af8f5df608450a6b" # tag v1.12.0
REPO="https://raw.githubusercontent.com/DLC-link/decentralization-manager/${COMMIT}/releases/v1"
HERE="$(cd "$(dirname "$0")" && pwd)"
VENDOR="${HERE}/.vendor"

# file name, SHA-256 of the file at the pinned commit
DARS=(
  "governance-action-v1-0.1.0.dar 4fc7912df4a0aeea3cfcc6ba07c880192a5fa88f7c75ed04b922602461b1e485"
  "governance-core-v1-0.1.0.dar b8d05903e63288d4114632f41386491cea215e177183514ea032fe35d24a9544"
)

mkdir -p "${VENDOR}"
for entry in "${DARS[@]}"; do
  read -r name sha <<<"${entry}"
  curl -fsSL -m 120 -o "${VENDOR}/${name}" "${REPO}/${name}"
  got="$(sha256sum "${VENDOR}/${name}" | cut -d' ' -f1)"
  if [[ "${got}" != "${sha}" ]]; then
    echo "SHA-256 mismatch for ${name}: got ${got}, expected ${sha}" >&2
    exit 1
  fi
  echo "  ${name}  ${got:0:16}…  ok"
done
