#!/usr/bin/env bash
# After: solana config set --url localhost && solana airdrop 10
# Creates an SPL mint (6 decimals) and mints 10_000_000 raw units to your wallet.
set -euo pipefail
DEC="${1:-6}"
spl-token create-token --decimals "$DEC"
echo "Copy the Token address printed above, then:"
echo "  spl-token create-account <MINT>"
echo "  spl-token mint <MINT> 10000"
echo "  spl-token balance <MINT>"
