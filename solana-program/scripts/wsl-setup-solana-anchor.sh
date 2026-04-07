#!/usr/bin/env bash
# Run in WSL: bash solana-program/scripts/wsl-setup-solana-anchor.sh
# If anchor build fails on missing libs, run once (with your password):
#   sudo apt-get update && sudo apt-get install -y libudev-dev pkg-config libssl-dev protobuf-compiler cmake build-essential
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

if ! command -v solana >/dev/null 2>&1; then
  echo "Installing Solana CLI..."
  curl -sSfL https://release.solana.com/stable/install | sh
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
solana --version

if ! command -v anchor >/dev/null 2>&1; then
  echo "Installing Anchor CLI 0.32.1 (first run: 10–25 min)..."
  cargo install --git https://github.com/coral-xyz/anchor --tag v0.32.1 anchor-cli --locked
fi
anchor --version

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo ">>> anchor build in $ROOT"
anchor build
echo ">>> npm ci"
npm ci
echo ">>> anchor test"
anchor test
echo "OK: anchor build + anchor test passed"
