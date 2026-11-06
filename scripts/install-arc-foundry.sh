#!/usr/bin/env bash
# Installs Circle's Arc-aware Foundry (https://github.com/circlefin/arc-foundry) side-by-side under
# .tools/arc-foundry/<version>/. It never touches the standard forge/cast/anvil on PATH.
# Standard Forge cannot execute Arc's native-USDC system precompiles; fork tests that move real USDC need this build
# together with `--network arc`. Run the fork tests with scripts/test-arc-fork.sh.
set -euo pipefail

VERSION="v0.8.0-4"
BASE="https://github.com/circlefin/arc-foundry/releases/download/${VERSION}"
SHA_LINUX_X86_64="78330505af7dc0d2c9b55fc1aed00d9d063581bb57054949d31ef1c1b4bdbc5e"
SHA_MACOS_ARM64="a99228f3403b3547e35c518387f9ad020e4293ac5e8ef4da7899a5495cf2e3e9"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.tools/arc-foundry/$VERSION"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  ASSET="arc-foundry-${VERSION}-x86_64-unknown-linux-gnu.tar.gz"; SHA="$SHA_LINUX_X86_64" ;;
  Darwin-arm64)  ASSET="arc-foundry-${VERSION}-aarch64-apple-darwin.tar.gz";     SHA="$SHA_MACOS_ARM64" ;;
  *) echo "No pinned arc-foundry asset for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

if [ -x "$DEST/forge" ]; then echo "already installed: $DEST/forge"; exit 0; fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$ASSET" "$BASE/$ASSET"
if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)"; fi
[ "$GOT" = "$SHA" ] || { echo "SHA256 mismatch for $ASSET: got $GOT, expected $SHA" >&2; exit 1; }
mkdir -p "$DEST"
tar -xzf "$TMP/$ASSET" -C "$DEST"
chmod +x "$DEST"/forge "$DEST"/cast "$DEST"/anvil 2>/dev/null || true
echo "installed arc-foundry $VERSION -> $DEST"
"$DEST/forge" --version | head -3
