#!/usr/bin/env bash
# Installs the pinned Uniswap v4 sources into lib/ (no git submodules, no .git dirs).
# Pins live in contracts/deps/v4-manifest.json; every fetch is verified against its commit SHA.
# Usage: bash scripts/install-v4-deps.sh   (needs network + git; idempotent)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/contracts/deps/v4-manifest.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# name | repo | commit | install dir | paths kept (license files are always kept)
read_pins() {
  python3 - "$MANIFEST" <<'PY'
import json,sys
for d in json.load(open(sys.argv[1]))["dependencies"]:
    print("|".join([d["name"], d["repo"], d["commit"], d["installPath"], " ".join(d["keep"])]))
PY
}

read_pins | while IFS='|' read -r name repo commit dest keep; do
  work="$TMP/$name"
  git init -q "$work"
  git -C "$work" remote add origin "$repo"
  git -C "$work" fetch -q --depth 1 origin "$commit"
  git -C "$work" checkout -q FETCH_HEAD
  got="$(git -C "$work" rev-parse HEAD)"
  [ "$got" = "$commit" ] || { echo "SHA mismatch for $name: $got != $commit" >&2; exit 1; }
  rm -rf "$ROOT/$dest"; mkdir -p "$ROOT/$dest"
  for p in $keep; do
    mkdir -p "$ROOT/$dest/$(dirname "$p")"
    cp -R "$work/$p" "$ROOT/$dest/$p"
  done
  for lic in "$work"/LICENSE* "$work"/licenses; do [ -e "$lic" ] && cp -R "$lic" "$ROOT/$dest/"; done
  echo "installed $name@$got -> $dest"
done
