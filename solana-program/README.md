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
