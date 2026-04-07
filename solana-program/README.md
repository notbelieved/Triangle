# Triangle escrow (Anchor)

Native SOL escrow PDAs per deal UUID. The **buyer** (deal creator) calls `buyer_release` to pay the **seller** when funded. Support authority can still `release` (same effect) or `refund_to` when the escrow is **frozen**.

After pulling changes that add `buyer_release`, **upgrade** the on-chain program (`solana program deploy …` with the same program id) so the new instruction exists.

## Prerequisites

- [Anchor](https://www.anchor-lang.com/docs/installation) 0.30.x  
- Solana CLI, Rust, BPF target  

## Build

```bash
cd solana-program
anchor build
```

## Program ID

After `anchor keys sync`, the program pubkey matches `target/deploy/triangle_escrow-keypair.json`. Current devnet deploy example: `7RnW9zpz4vwmebbPJqh5hSTdvUSrFGdZGZYWFZSbfgcV`.

For a **new** program address:

1. `solana-keygen new -o target/deploy/triangle_escrow-keypair.json`
2. `anchor keys sync`
3. Build BPF (e.g. `cargo-build-sbf --manifest-path programs/triangle_escrow/Cargo.toml`) and deploy with `solana program deploy ... --use-rpc` if TPU times out behind a firewall.
4. Set `TRIANGLE_ESCROW_PROGRAM_ID` in `server/.env`.

Optional: `solana-program/scripts/deploy-devnet-from-env.sh` reads `SOLANA_AUTHORITY_PRIVATE_KEY` from `server/.env` (WSL, LF line endings). Add `--use-rpc` to the `solana program deploy` line if needed.

## One-time on-chain setup

1. Put the **same** authority wallet secret in `SOLANA_AUTHORITY_PRIVATE_KEY` (base58).
2. Call **POST** `/api/support/program/initialize` with header `X-Support-Secret: <SUPPORT_API_SECRET>`.

This creates the global `config` PDA with `authority` = that wallet.

## Security

- Never commit private keys or paste them in chat.
- Rotate any key that was exposed.

## Local mainnet fork (optional)

`scripts/start-mainnet-fork.sh` or `scripts/start-mainnet-fork.ps1` starts `solana-test-validator` with `--clone` of mainnet SPL mints (wSOL, USDC), legacy Pyth-related accounts from the common tutorial list, and core programs. **Set `MAINNET_RPC_URL` (full URL) or `HELIUS_API_KEY`** — use an archive-capable RPC (Helius, Alchemy). Copy `solana-program/.env.example` to `.env` locally (do not commit).

```bash
cd solana-program
# Windows PowerShell:
# $env:HELIUS_API_KEY="your_key"
# ./scripts/start-mainnet-fork.ps1
./scripts/start-mainnet-fork.sh
```

In another terminal:

```bash
solana config set --url http://127.0.0.1:8899
solana airdrop 10
```

Then build with a **longer Pyth staleness window** for forked feeds that never update:

```bash
anchor build -- --features fork-test
solana program deploy target/deploy/triangle_escrow.so --program-id target/deploy/triangle_escrow-keypair.json
```

### Important: Pyth in this repo

`triangle_escrow` uses **Pyth Solana Receiver** (`PriceUpdateV2`), not legacy oracle accounts (`8y3WW…` etc.). The fork scripts clone the **receiver program**, **push oracle program**, and the **SOL/USD price feed PDA** (shard 0) so `refresh_rwa_risk_pyth` can read a real snapshot. Feeds on the fork do **not** update; build with **`fork-test`** (24h max age) via `anchor build -- --features fork-test` or `scripts/run-fork-rwa-test.*`.

**Fork + Pyth integration test:** `tests/rwa-fork-mainnet.ts` (skipped unless `RWA_FORK_TEST=1`). After the fork validator is up and your wallet has SOL on localhost:

```bash
npm run test:fork
# or: npm run test:fork:win   # PowerShell (anchor/solana on PATH)
# or: bash scripts/run-fork-rwa-test.sh
```

Quick checks: use **`OracleMode::Mock`** with plain `anchor test` (`tests/rwa-mock-local.ts`) when you do not need a mainnet fork.

### Mint a test SPL on the fork

```bash
./scripts/mint-rwa-token-local.sh 6
# follow printed spl-token commands
```

### Integration test (mock RWA)

```bash
cd solana-program
npm install
anchor build
anchor test
```

This runs `tests/rwa-mock-local.ts` against a fresh local validator (default `anchor test` behavior).

**Windows + WSL:** install Node in WSL (`nvm install 20`), then use `scripts/wsl-anchor-test.sh` (adds nvm + Solana + Anchor to `PATH`). `[programs.localnet]` must match `declare_id!` / `target/deploy/triangle_escrow-keypair.json` (currently same pubkey as devnet: `7RnW9zpz4vwmebbPJqh5hSTdvUSrFGdZGZYWFZSbfgcV`). To use your **fork** validator instead:

```bash
# Terminal 1: fork script running
# Terminal 2:
anchor test --skip-local-validator
```

You must **deploy** the program to that validator first (`anchor build` then `solana program deploy …`).

### Point the Node API at localhost

Set `SOLANA_RPC_URL=http://127.0.0.1:8899` and `TRIANGLE_ESCROW_PROGRAM_ID` to your **localnet** program id from `Anchor.toml` (`programs.localnet`) after deploy.
