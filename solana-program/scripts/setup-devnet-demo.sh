#!/usr/bin/env bash
# setup-devnet-demo.sh
#
# Creates a rwaGOLD SPL token on Solana Devnet and funds two demo wallets
# (seller + buyer) so the demo can run without any on-the-day setup.
#
# Prerequisites:
#   - solana CLI  (https://docs.solana.com/cli/install-solana-cli-tools)
#   - spl-token CLI  (cargo install spl-token-cli)
#   - @metaplex-foundation/mpl-token-metadata helpers (optional, for Phantom display)
#
# Usage:
#   chmod +x setup-devnet-demo.sh
#   ./setup-devnet-demo.sh
#
# After running, copy the printed MINT address into:
#   server/.env      -> DEMO_RWA_MINT=<MINT>
#   web/.env.development -> VITE_DEMO_RWA_MINT=<MINT>

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
DECIMALS=6
INITIAL_SUPPLY=100000    # tokens minted to seller
BUYER_TRANSFER=10000     # tokens transferred to buyer for demo deposits
AIRDROP_SOL=2            # SOL airdrop per wallet
CLUSTER="devnet"
RPC="https://api.devnet.solana.com"

# ─── Switch to devnet ─────────────────────────────────────────────────────────
echo "==> Switching to devnet…"
solana config set --url "$RPC"

# ─── Generate demo wallets (skip if files exist) ──────────────────────────────
if [ ! -f demo-seller.json ]; then
  echo "==> Generating seller wallet…"
  solana-keygen new --no-bip39-passphrase --outfile demo-seller.json --force
else
  echo "==> Using existing demo-seller.json"
fi

if [ ! -f demo-buyer.json ]; then
  echo "==> Generating buyer wallet…"
  solana-keygen new --no-bip39-passphrase --outfile demo-buyer.json --force
else
  echo "==> Using existing demo-buyer.json"
fi

SELLER_ADDRESS=$(solana-keygen pubkey demo-seller.json)
BUYER_ADDRESS=$(solana-keygen pubkey demo-buyer.json)

echo ""
echo "  Seller: $SELLER_ADDRESS"
echo "  Buyer:  $BUYER_ADDRESS"

# ─── Airdrop SOL ─────────────────────────────────────────────────────────────
# Devnet airdrop can fail or be rate-limited — retry twice with a delay.
airdrop_with_retry() {
  local ADDRESS="$1"
  local LABEL="$2"
  for i in 1 2 3; do
    echo "==> Airdrop $AIRDROP_SOL SOL to $LABEL (attempt $i)…"
    if solana airdrop "$AIRDROP_SOL" "$ADDRESS" --url "$RPC" 2>&1; then
      break
    fi
    echo "    Airdrop failed, waiting 10 s…"
    sleep 10
  done
}

airdrop_with_retry "$SELLER_ADDRESS" "seller"
airdrop_with_retry "$BUYER_ADDRESS"  "buyer"

echo "==> Seller balance: $(solana balance "$SELLER_ADDRESS" --url "$RPC")"
echo "==> Buyer balance:  $(solana balance "$BUYER_ADDRESS"  --url "$RPC")"

# ─── Create rwaGOLD token ─────────────────────────────────────────────────────
echo ""
echo "==> Creating rwaGOLD SPL token (decimals=$DECIMALS)…"
# Use seller wallet as the mint authority
MINT_OUTPUT=$(spl-token create-token \
  --decimals "$DECIMALS" \
  --fee-payer demo-seller.json \
  --mint-authority demo-seller.json \
  --url "$RPC" \
  2>&1)

echo "$MINT_OUTPUT"
MINT=$(echo "$MINT_OUTPUT" | grep -oP '(?<=Creating token )\S+' || true)

if [ -z "$MINT" ]; then
  # Some versions print differently
  MINT=$(echo "$MINT_OUTPUT" | grep -E "^[1-9A-HJ-NP-Za-km-z]{32,48}$" | head -1 || true)
fi

if [ -z "$MINT" ]; then
  echo ""
  echo "ERROR: Could not parse mint address from spl-token output."
  echo "Please copy it manually from the output above."
  exit 1
fi

echo ""
echo "==> Mint address: $MINT"

# ─── Create token accounts ───────────────────────────────────────────────────
echo ""
echo "==> Creating token account for seller…"
spl-token create-account "$MINT" \
  --owner "$SELLER_ADDRESS" \
  --fee-payer demo-seller.json \
  --url "$RPC"

echo "==> Creating token account for buyer…"
spl-token create-account "$MINT" \
  --owner "$BUYER_ADDRESS" \
  --fee-payer demo-seller.json \
  --fund-recipient \
  --url "$RPC"

# ─── Mint tokens to seller ────────────────────────────────────────────────────
echo ""
echo "==> Minting $INITIAL_SUPPLY rwaGOLD to seller…"
spl-token mint "$MINT" "$INITIAL_SUPPLY" \
  --mint-authority demo-seller.json \
  --fee-payer demo-seller.json \
  --url "$RPC"

echo "==> Seller rwaGOLD balance: $(spl-token balance "$MINT" --owner "$SELLER_ADDRESS" --url "$RPC")"

# ─── Transfer tokens to buyer ─────────────────────────────────────────────────
echo ""
echo "==> Transferring $BUYER_TRANSFER rwaGOLD to buyer…"
spl-token transfer "$MINT" "$BUYER_TRANSFER" "$BUYER_ADDRESS" \
  --owner demo-seller.json \
  --fee-payer demo-seller.json \
  --fund-recipient \
  --url "$RPC"

echo "==> Buyer rwaGOLD balance:  $(spl-token balance "$MINT" --owner "$BUYER_ADDRESS" --url "$RPC")"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DEMO SETUP COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  rwaGOLD Mint:     $MINT"
echo "  Seller wallet:    $SELLER_ADDRESS  (demo-seller.json)"
echo "  Buyer wallet:     $BUYER_ADDRESS   (demo-buyer.json)"
echo ""
echo "  Add to server/.env:"
echo "    DEMO_RWA_MINT=$MINT"
echo ""
echo "  Add to web/.env.development:"
echo "    VITE_DEMO_RWA_MINT=$MINT"
echo ""
echo "  IMPORTANT: demo-seller.json and demo-buyer.json contain private keys."
echo "  Do NOT commit them to git. They are already in .gitignore."
echo ""
echo "  Pyth XAU/USD feed (for Hermes price display):"
echo "    765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2"
echo ""
echo "  Pre-demo checklist (run these the day before the presentation):"
echo "    solana balance $SELLER_ADDRESS --url devnet"
echo "    solana balance $BUYER_ADDRESS --url devnet"
echo "    spl-token balance $MINT --owner $BUYER_ADDRESS --url devnet"
echo ""
echo "  Register Helius webhook after setup:"
echo "    POST https://api.helius.xyz/v0/webhooks?api-key=\$HELIUS_API_KEY"
echo "    Body: { webhookURL, accountAddresses: [VAULT_ATA], transactionTypes: ['TRANSFER'],"
echo "            webhookType: 'enhanced', network: 'devnet', authHeader: \$HELIUS_WEBHOOK_SECRET }"
echo "    (VAULT_ATA is shown in the deal page after Init RWA Escrow)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
