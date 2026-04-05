# Security

- **Never commit** `.env`, API secrets, Privy keys, or `SOLANA_AUTHORITY_PRIVATE_KEY`. Use `server/env.example.txt` as a template only.
- If a secret was committed, rotate it immediately in the provider dashboard (Privy, database, etc.) and purge it from git history.
- Report vulnerabilities privately to the maintainers (open a security advisory on GitHub if the repo supports it).
