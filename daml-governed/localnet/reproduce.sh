#!/usr/bin/env bash
# Reproduce the governed compression cycle on Decentralization Manager's LocalNet sandbox, from a clean checkout.
#
#   daml-governed/localnet/reproduce.sh [work-dir]      (default: <repo>/.localnet-work)
#
# What it does, in order:
#   1. checks the prerequisites (below);
#   2. builds compressrail, the governance DARs (vendored, SHA-256 checked) and compressrail-governed, checks the
#      two package ids against the ones deployed on DevNet, and runs the Daml test suites;
#   3. fetches Decentralization Manager's sandbox at a pinned commit, pins it to the versions DevNet runs
#      (Decentralization Manager v1.12.0, Splice LocalNet 0.8.4), and starts it with its own up.sh and seed.sh;
#   4. runs rehearse.py (the governed cycle, negative tests, visibility) and failures.py (approval does not
#      override the package checks), and prints the result.
#
# Prerequisites: Linux x86-64 or macOS; Docker Engine with Compose v2.1.1+ (at least 12 GB memory and 4 CPUs for
# Docker); git, curl, jq, tar, python3 (3.10+); a JDK 17+; dpm on PATH (see daml-governed/README.md).
#
# The sandbox runs with authentication off. Run it on a machine whose ports other hosts cannot reach.
# Stop it afterwards with: <work-dir>/decentralization-manager/hackathon/down.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GOV="$(dirname "$HERE")"
ROOT="$(dirname "$GOV")"
WORK="${1:-$ROOT/.localnet-work}"
DM_REPO="https://github.com/DLC-link/decentralization-manager.git"
DM_COMMIT="b2fc543f611585f1c244cc81de28d6fe16043bc7"   # hackathon branch, 30 Sep 2026
LOCALNET_VERSION="0.8.4"
DECMAN_IMAGE="public.ecr.aws/dlc-link/decentralization-manager:v1.12.0"
PIN_CR="a6f77b297c7fda8dfadc10a7211a6755f82451c70d5fc6854cef1a7094b6f619"    # compressrail 0.0.3
PIN_GOV="d7ea09960153f96d4f7667cb1530bf55889256f3f9e7c3d1e4186bdb04ed7ddc"   # compressrail-governed 0.0.1

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
quiet() { local out; out=$("$@" 2>&1) || { printf '%s\n' "$out" | tail -40; die "failed: $*"; }; }

step "Prerequisites"
missing=""
for t in docker git curl jq tar python3 java dpm; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
[ -z "$missing" ] || die "missing:$missing (see the prerequisites at the top of this script)"
docker compose version --short >/dev/null 2>&1 || die "docker compose v2 is required"
docker info >/dev/null 2>&1 || die "cannot talk to Docker (is the daemon running, and is this user allowed to use it?)"
java_major=$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)
[ "${java_major:-0}" -ge 17 ] || die "JDK 17 or newer is required (found ${java_major:-none})"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "python 3.10 or newer is required"
echo "    docker compose $(docker compose version --short), java $java_major, $(python3 --version), dpm $(dpm --version 2>/dev/null | head -1)"
arch=$(uname -m)
if [ "$(uname -s)" = Linux ] && [ "$arch" != x86_64 ]; then
    # The Decentralization Manager image is published for linux/amd64 only.
    [ -e /proc/sys/fs/binfmt_misc/qemu-x86_64 ] || die "the Decentralization Manager image is amd64-only; on $arch \
install amd64 emulation first (Ubuntu: sudo apt-get install -y qemu-user-static binfmt-support)"
    echo "    $arch host: amd64 emulation is registered (the manager image is amd64-only)"
fi
mkdir -p "$WORK/dars"

step "Build and test the Daml packages"
sdk=$(sed -nE 's/^sdk-version: *//p' "$ROOT/daml/daml.yaml")
dpm install "$sdk" >/dev/null 2>&1 || dpm install "$sdk"
echo "    SDK $sdk installed"
(cd "$ROOT/daml" && quiet dpm build && echo "    compressrail built")
(cd "$GOV" && ./vendor.sh && quiet dpm build && echo "    compressrail-governed built")
(cd "$GOV/rules" && quiet dpm build && echo "    compressrail-rules built (prototype, used by the tests)")
python3 - "$ROOT/daml/.daml/dist/compressrail-0.0.3.dar" compressrail-0.0.3 "$PIN_CR" \
          "$GOV/.daml/dist/compressrail-governed-0.0.1.dar" compressrail-governed-0.0.1 "$PIN_GOV" <<'PY'
import re, sys, zipfile
args = sys.argv[1:]
for dar, name, pin in zip(args[0::3], args[1::3], args[2::3]):
    ids = {m.group(1) for n in zipfile.ZipFile(dar).namelist() for m in [re.match(re.escape(name) + r"-([0-9a-f]{64})/", n)] if m}
    if ids != {pin}:
        sys.exit(f"ERROR: {name} built with package id {ids}, expected {pin} (the id deployed on DevNet)")
    print(f"    {name}: package id {pin[:16]}… matches the DevNet deployment")
PY
cp "$ROOT/daml/.daml/dist/compressrail-0.0.3.dar" "$GOV/.daml/dist/compressrail-governed-0.0.1.dar" "$WORK/dars/"
run_tests() {  # <dir> <label>
    local out; out=$(cd "$1" && dpm test 2>&1) || { printf '%s\n' "$out" | tail -30; die "$2: Daml tests failed"; }
    echo "    $2: $(printf '%s\n' "$out" | grep -c ': ok, ') Daml tests passed"
}
run_tests "$ROOT/daml" "compressrail"
run_tests "$GOV/test" "compressrail-governed"

step "Decentralization Manager sandbox at ${DM_COMMIT:0:7} (v1.12.0, Splice LocalNet $LOCALNET_VERSION)"
DM="$WORK/decentralization-manager"
if [ ! -d "$DM/.git" ]; then git clone -q "$DM_REPO" "$DM"; fi
git -C "$DM" fetch -q origin "$DM_COMMIT" 2>/dev/null || true
git -C "$DM" checkout -q "$DM_COMMIT"
sed -i.bak -E "s#^LOCALNET_VERSION=.*#LOCALNET_VERSION=$LOCALNET_VERSION#; s#^DECMAN_IMAGE=.*#DECMAN_IMAGE=$DECMAN_IMAGE#" \
    "$DM/hackathon/versions.env" && rm -f "$DM/hackathon/versions.env.bak"
grep -E "^(LOCALNET_VERSION|DECMAN_IMAGE)=" "$DM/hackathon/versions.env" | sed 's/^/    /'
(cd "$DM" && ./hackathon/up.sh && ./hackathon/seed.sh)

step "Governed cycle (rehearse.py) and execution failures (failures.py)"
cd "$WORK"
log="$WORK/reproduce-$(date +%Y%m%d-%H%M%S).log"
CR_OUT_DIR="$WORK" python3 "$HERE/rehearse.py" "$DM" "$WORK/dars" 2>&1 | tee "$log"
CR_OUT_DIR="$WORK" python3 "$HERE/failures.py" "$DM" "$WORK/dars" 2>&1 | tee -a "$log"

step "Result"
pass=$(grep -cE "^ +PASS " "$log" || true)
fail=$(grep -cE "^ +FAIL |still holds its two original trades: False" "$log" || true)
echo "    $pass checks passed, $fail failed. Log: $log; JSON results: $WORK/rehearsal-*.json, $WORK/failures-*.json"
[ "$fail" -eq 0 ] || exit 1
