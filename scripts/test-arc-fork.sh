#!/usr/bin/env bash
# Runs the whole Foundry suite, including contracts/test/fork, with Circle's Arc-aware Foundry (`--network arc`).
# Standard forge cannot execute Arc's native-USDC precompiles, so the default `forge test` skips contracts/test/fork.
# Usage: bash scripts/test-arc-fork.sh [extra forge test args, e.g. --match-path "contracts/test/fork/*" -vv]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/install-arc-foundry.sh" >/dev/null
FORGE="$ROOT/.tools/arc-foundry/v0.8.0-4/forge"
cd "$ROOT"
echo "using: $("$FORGE" --version | head -1) ($FORGE)"
FOUNDRY_PROFILE=arcfork exec "$FORGE" test --network arc "$@"
