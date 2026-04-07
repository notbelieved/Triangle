#!/usr/bin/env bash
# Local validator with cloned mainnet accounts: SPL mints, Pyth Receiver + Push Oracle + SOL/USD feed PDA,
# plus legacy Pyth tutorial accounts. Use archive RPC (HELIUS_API_KEY / MAINNET_RPC_URL).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -n "${MAINNET_RPC_URL:-}" ]]; then
  RPC="$MAINNET_RPC_URL"
elif [[ -n "${HELIUS_API_KEY:-}" ]]; then
  RPC="https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
else
  echo "Set MAINNET_RPC_URL (full URL) or HELIUS_API_KEY for archive-capable mainnet RPC."
  exit 1
fi

echo "Using RPC: ${RPC//\?api-key=*/?api-key=***}"
cd "$ROOT"

# Pyth Solana Receiver (pull) + push oracle + SOL/USD price feed PDA shard 0 — used by tests/rwa-fork-mainnet.ts
# Legacy accounts below kept for tooling / reference.
exec solana-test-validator \
  --url "$RPC" \
  --reset \
  --clone TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  --clone ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
  --clone So11111111111111111111111111111111111111112 \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --clone rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ \
  --clone pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT \
  --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE \
  --clone 8y3WWjvmSmVGWVKH1rCA7VTRmuU7QbJ9axafSsBX5FcD \
  --clone J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix \
  --clone FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH \
  "$@"
