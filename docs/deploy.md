# Deploy via GitHub Actions (SSH)

On every push to `main`, the **Deploy** workflow builds the web app and rsyncs `web/dist` and `server/` to your VPS, then runs `npm ci --omit=dev` on the server and restarts **`triangle-api`** (systemd or pm2).

## One-time server setup

1. Install **Node 20+**, **nginx**, **PostgreSQL**, **git** (Debian/Ubuntu example):

   ```bash
   apt update && apt install -y nginx postgresql rsync curl
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs
   ```

2. Create app directory (must match `DEPLOY_PATH` secret, default `/opt/triangle`):

   ```bash
   mkdir -p /opt/triangle/web /opt/triangle/server
   ```

3. Put **`server/.env`** on the server (never commit it). Use `server/env.example.txt` as a reference.

4. Database: create user/DB, then on the server run once:

   ```bash
   cd /opt/triangle/server && npm ci && npm run db:setup
   ```

5. **systemd** (optional, recommended):

   ```bash
   cp /opt/triangle/deploy/triangle-api.service /etc/systemd/system/triangle-api.service
   # Edit WorkingDirectory/EnvironmentFile if your path differs; set User= if not root
   systemctl daemon-reload
   systemctl enable --now triangle-api
   ```

6. **nginx**: copy `deploy/nginx-triangle.conf` into `sites-available`, enable the site, `nginx -t && systemctl reload nginx`.

## SSH key for GitHub

On your laptop or the server:

```bash
ssh-keygen -t ed25519 -f gh-deploy -N ""
ssh-copy-id -i gh-deploy.pub root@YOUR_SERVER_IP
```

In the repo **Settings → Secrets and variables → Actions**, add:

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | Server IP or hostname |
| `DEPLOY_SSH_KEY` | **Private** key contents (`gh-deploy` file, full PEM) |
| `DEPLOY_USER` | SSH user (default `root` if omitted) |
| `DEPLOY_PATH` | Remote path (default `/opt/triangle`) |
| `DEPLOY_PORT` | SSH port (default `22` if omitted) |
| `VITE_PRIVY_APP_ID` | Privy app id for **production** web build |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional; WalletConnect project id |

If `DEPLOY_HOST` or `DEPLOY_SSH_KEY` is missing, the workflow **skips deploy** and CI still passes.

## After deploy

API listens on **port 3001** by default. Nginx should proxy `/api` to it. Ensure firewall allows **80/443** as needed.
