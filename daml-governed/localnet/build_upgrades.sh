#!/usr/bin/env bash
# Builds two upgrade-compatible successors used only by the LocalNet upgrade
# rehearsal (upgrades.py). Each changes behaviour behind an unchanged interface,
# which smart-contract upgrading permits:
#
#   compressrail-governed 0.0.9  executeImpl runs only the first permit
#                                (skips the package checks)
#   compressrail 0.0.9           Permit_Execute tears up the trades but creates
#                                no replacement leg
#   compressrail 0.0.10          the same change, as a package the firms' node has
#                                not vetted yet
#   compressrail-governed 0.0.10 the original executeImpl, compiled against
#                                compressrail 0.0.10 — an action upgrade whose only
#                                change is the permit code it links to
#
# Never upload these anywhere but a rehearsal sandbox.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"           # CompressRail/
OUT="${1:-$HERE/.upgrades}"
DPM="${DPM:-$HOME/.dpm/bin/dpm}"
rm -rf "$OUT" && mkdir -p "$OUT"

# compressrail 0.0.9
cp -r "$ROOT/daml" "$OUT/cr" && rm -rf "$OUT/cr/.daml"
sed -i 's/^version: .*/version: 0.0.9/' "$OUT/cr/daml.yaml"
python3 - "$OUT/cr/CompressRail/Gate.daml" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = """        forA legs $ \\l -> create BilateralTrade with
          cptyA = l.cptyA
          cptyB = l.cptyB
          tradeRef = l.tradeRef
          terms = l.terms
          commitment = l.commitment
          auditors = []"""
new = """        -- REHEARSAL ONLY: the upgraded permit drops the replacement legs.
        pure []"""
assert s.count(old) == 1, "Permit_Execute body not found"
open(p, "w").write(s.replace(old, new, 1))
PY
(cd "$OUT/cr" && "$DPM" build >/dev/null)

# compressrail-governed 0.0.9 (still built against compressrail 0.0.3)
mkdir -p "$OUT/gov"
cp -r "$ROOT/daml-governed/daml" "$OUT/gov/daml"
sed -e 's/^version: .*/version: 0.0.9/' \
    -e "s#\.\./daml/\.daml/dist/compressrail-0\.0\.3\.dar#$ROOT/daml/.daml/dist/compressrail-0.0.3.dar#" \
    -e "s#\.vendor/#$ROOT/daml-governed/.vendor/#" \
    "$ROOT/daml-governed/daml.yaml" > "$OUT/gov/daml.yaml"
python3 - "$OUT/gov/daml/CompressRail/Governed.daml" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = """      executeImpl = do
        _ <- executePackage governanceParty gateId permitRefs deadline permits salts
        pure ()"""
new = """      -- REHEARSAL ONLY: the upgraded action runs the first permit and skips every check.
      executeImpl = case permits of
        p :: _ -> do
          _ <- exercise p Permit_Execute
          pure ()
        [] -> pure ()"""
assert s.count(old) == 1, "executeImpl not found"
open(p, "w").write(s.replace(old, new, 1))
PY
(cd "$OUT/gov" && "$DPM" build >/dev/null)

# compressrail 0.0.10: the same permit change under a version not yet vetted on the firms' node
cp -r "$OUT/cr" "$OUT/cr10" && rm -rf "$OUT/cr10/.daml"
sed -i 's/^version: .*/version: 0.0.10/' "$OUT/cr10/daml.yaml"
(cd "$OUT/cr10" && "$DPM" build >/dev/null)

# compressrail-governed 0.0.10: unchanged logic, linked to compressrail 0.0.10
mkdir -p "$OUT/gov10"
cp -r "$ROOT/daml-governed/daml" "$OUT/gov10/daml"
sed -e 's/^version: .*/version: 0.0.10/' \
    -e "s#\.\./daml/\.daml/dist/compressrail-0\.0\.3\.dar#$OUT/cr10/.daml/dist/compressrail-0.0.10.dar#" \
    -e "s#\.vendor/#$ROOT/daml-governed/.vendor/#" \
    "$ROOT/daml-governed/daml.yaml" > "$OUT/gov10/daml.yaml"
(cd "$OUT/gov10" && "$DPM" build >/dev/null)

cp "$OUT/cr/.daml/dist/compressrail-0.0.9.dar" "$OUT/gov/.daml/dist/compressrail-governed-0.0.9.dar" \
   "$OUT/cr10/.daml/dist/compressrail-0.0.10.dar" "$OUT/gov10/.daml/dist/compressrail-governed-0.0.10.dar" "$OUT/"
for d in compressrail-0.0.9.dar compressrail-governed-0.0.9.dar compressrail-0.0.10.dar compressrail-governed-0.0.10.dar; do
  echo "  $d  $("$DPM" damlc inspect-dar --json "$OUT/$d" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["main_package_id"][:16])')…"
done
