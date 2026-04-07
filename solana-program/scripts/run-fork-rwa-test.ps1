# Build with fork-test, deploy to localhost, run rwa-fork-mainnet.ts only.
# Requires: fork validator running, solana config url localhost, airdrop.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:ANCHOR_PROVIDER_URL) { $env:ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899" }
if (-not $env:ANCHOR_WALLET) { $env:ANCHOR_WALLET = "$env:USERPROFILE\.config\solana\id.json" }
$env:RWA_FORK_TEST = "1"

anchor build -- --features fork-test
solana program deploy target/deploy/triangle_escrow.so `
  --url $env:ANCHOR_PROVIDER_URL `
  --program-id target/deploy/triangle_escrow-keypair.json

npx ts-mocha -p ./tsconfig.json -t 1000000 tests/rwa-fork-mainnet.ts
