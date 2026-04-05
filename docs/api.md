# API

**How to use it** — overview of the backend HTTP API (`server/`). All routes are under the `/api` prefix unless noted.

## Authentication

Most routes require:

```http
Authorization: Bearer <Privy access token>
```

After login, the client syncs the user to the database with `POST /api/auth/sync`.

## Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |

## User (deal participant)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/sync` | Sync profile with Privy |
| GET | `/api/deals` | List deals for the current user |
| POST | `/api/deals` | Create a deal |
| GET | `/api/deals/:id` | Deal details |
| POST | `/api/deals/:id/accept` | Accept a deal |
| POST | `/api/deals/:id/request-support` | Request support |
| GET | `/api/deals/:id/messages` | Chat messages |
| POST | `/api/deals/:id/messages` | Send a chat message |

## Escrow (participant)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/deals/:id/escrow` | Escrow state / UI metadata |
| POST | `/api/deals/:id/escrow/prepare-init` | Build unsigned init transaction |
| POST | `/api/deals/:id/escrow/ack-init` | Confirm signed init |
| POST | `/api/deals/:id/escrow/prepare-deposit` | Build unsigned deposit transaction |
| POST | `/api/deals/:id/escrow/prepare-release` | Build unsigned release (buyer) |
| POST | `/api/deals/:id/escrow/ack-release` | Confirm signed release |
| POST | `/api/deals/:id/escrow/sync` | Sync on-chain state (status, lamports) |

## Support (in-app support role)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/support/deals` | Deals with support requested |
| POST | `/api/support/deals/:id/status` | Update deal status (support) |
| GET | `/api/support/program/status` | Whether `config` exists, RPC, authority |
| POST | `/api/support/program/initialize` | One-time on-chain `config` PDA creation |
| POST | `/api/support/escrow/freeze` | Freeze / unfreeze escrow |
| POST | `/api/support/escrow/release` | Authority release |
| POST | `/api/support/escrow/refund` | Refund to a given address (after freeze) |

Request bodies and error codes are defined in `server/index.js` and `server/escrowApi.js`.

## Environment

Template: `server/env.example.txt`. At minimum you need `PRIVY_*`, `DATABASE_URL`; for chain operations also `TRIANGLE_ESCROW_PROGRAM_ID`, `SOLANA_RPC_URL`, `SOLANA_AUTHORITY_PRIVATE_KEY` (support-signed transactions).

## See also

- [architecture.md](architecture.md) — who signs which transactions  
- [roadmap.md](roadmap.md) — roadmap  
