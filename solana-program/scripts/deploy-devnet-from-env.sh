#!/usr/bin/env bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/server"
set -a
[ -f .env ] && . ./.env
set +a
if [ -z "${SOLANA_AUTHORITY_PRIVATE_KEY:-}" ]; then
  echo "Add SOLANA_AUTHORITY_PRIVATE_KEY (base58) to server/.env"
  exit 1
fi
export DEPLOY_SECRET="$SOLANA_AUTHORITY_PRIVATE_KEY"
NODE_PATH="$ROOT/server/node_modules" node "$ROOT/solana-program/scripts/write-deploy-keypair.cjs"
solana config set --url https://api.devnet.solana.com --keypair /tmp/triangle-deploy.json
solana program deploy "$ROOT/solana-program/target/deploy/triangle_escrow.so" \
  --program-id "$ROOT/solana-program/target/deploy/triangle_escrow-keypair.json" \
  --url https://api.devnet.solana.com \
  --keypair /tmp/triangle-deploy.json \
  --use-rpc
rm -f /tmp/triangle-deploy.json
echo "Deployed. Set TRIANGLE_ESCROW_PROGRAM_ID to program pubkey."
