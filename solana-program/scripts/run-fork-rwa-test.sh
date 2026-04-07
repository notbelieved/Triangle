#!/usr/bin/env bash
# Build with fork-test (long Pyth staleness), deploy to localhost, run rwa-fork-mainnet.ts only.
# Terminal 1: scripts/start-mainnet-fork.sh
# Terminal 2: solana config set --url http://127.0.0.1:8899 && solana airdrop 10
# Terminal 3: bash scripts/run-fork-rwa-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
export RWA_FORK_TEST=1

anchor build -- --features fork-test
solana program deploy target/deploy/triangle_escrow.so \
  --url "$ANCHOR_PROVIDER_URL" \
  --program-id target/deploy/triangle_escrow-keypair.json

exec npx ts-mocha -p ./tsconfig.json -t 1000000 tests/rwa-fork-mainnet.ts
