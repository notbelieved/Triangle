# Local validator with cloned mainnet accounts. Requires Solana CLI on PATH.
# Set MAINNET_RPC_URL or HELIUS_API_KEY (see solana-program/.env.example).

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

if ($env:MAINNET_RPC_URL) {
  $rpc = $env:MAINNET_RPC_URL
} elseif ($env:HELIUS_API_KEY) {
  $rpc = "https://mainnet.helius-rpc.com/?api-key=$($env:HELIUS_API_KEY)"
} else {
  Write-Host "Set MAINNET_RPC_URL or HELIUS_API_KEY"
  exit 1
}

Write-Host "Starting solana-test-validator (RPC key hidden)..."

Push-Location $Root
try {
  & solana-test-validator `
    --url $rpc `
    --reset `
    --clone TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA `
    --clone ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL `
    --clone So11111111111111111111111111111111111111112 `
    --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v `
    --clone rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ `
    --clone pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT `
    --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE `
    --clone 8y3WWjvmSmVGWVKH1rCA7VTRmuU7QbJ9axafSsBX5FcD `
    --clone J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix `
    --clone FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH
} finally {
  Pop-Location
}
