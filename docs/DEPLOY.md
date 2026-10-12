# Deploying Team Workspace

Three ways to run it, cheapest first. All use the same Docker images and `.env` settings.

| Option | Monthly cost | Good for | Main trade-off |
|---|---|---|---|
| **A. Laptop/office PC + Cloudflare Tunnel** | ₹0 (plus electricity) | Prototype, small team trial | Down whenever the machine sleeps, restarts or loses internet |
| **B. Railway** | ≈ $5–10 (≈ ₹450–900), usage-based | You already use Railway | Volumes and Postgres are Railway-managed; check their current pricing |
| **C. Small VPS + Cloudflare Tunnel** | ≈ ₹450–900 (Hetzner) / ≈ ₹2,000 (India region) | Always-on production | You patch the server |

Everything below is free software. Only the hosting differs.

---

## A. Laptop + Cloudflare Tunnel (free, prototype)

Cloudflare Tunnel gives the app a public HTTPS address on `uncanned.in` without opening any
router ports, and works from anywhere. The laptop makes an outbound connection to Cloudflare.

### 1. Prerequisites
- Docker Desktop (Windows/macOS) or Docker Engine (Linux), set to start on login.
- Windows: Settings → System → Power → **never sleep when plugged in**. Otherwise the app goes offline.
- About 2 GB free RAM and a few GB of disk.

### 2. Configure
```sh
cd team-workspace
copy .env.example .env      # Windows (use cp on macOS/Linux)
```
Fill in `.env`:
- `APP_URL=https://workspace.uncanned.in` (the hostname you'll create in step 3).
- `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `BACKUP_PASSPHRASE`: long random values.
  Generate each with `docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"`.
  **Save `BACKUP_PASSPHRASE` in a password manager.** Backups can't be restored without it.

### 3. Create the Cloudflare Tunnel (free)
1. Cloudflare dashboard → **Zero Trust** → Networks → **Tunnels** → Create a tunnel → *Cloudflared*.
2. Name it `team-workspace`. Copy the **token** shown in the install command (the long string after `--token`) into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`. You don't need to install anything on the laptop; Docker runs cloudflared.
3. **Public hostname**: subdomain `workspace`, domain `uncanned.in`, service **HTTP** → `app:3000`.
4. Optional extra gate: Zero Trust → Access → add an application for `workspace.uncanned.in` that only allows `@uncanned.in` emails. Free for up to 50 users. The app has its own login either way.

### 4. Email (optional, free with Google Workspace)
Uses the shared mailbox for invitations and password resets.
1. Sign in to the shared mailbox → Google Account → Security → turn on **2-Step Verification**.
2. Security → **App passwords** → create one named "Team Workspace".
3. In `.env`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=<mailbox>`, `SMTP_PASSWORD=<app password>`.

Without email, admins copy invite and reset links from **Settings → Members** and send them
on WhatsApp or similar. Everything else works the same.

### 5. Start
```sh
docker compose --profile tunnel up -d --build
docker compose exec app node dist/setup.cjs --workspace "Uncanned" --email you@uncanned.in --name "Your Name"
```
The first build can take 10–30 minutes on a laptop. The second command asks for the first admin's password. Then open `https://workspace.uncanned.in`,
sign in, and invite the team from **Settings → Members**.

Locally it is also at `http://localhost:3000` (only from this machine).

### 6. Keep it running
- `restart: unless-stopped` brings everything back after a reboot once Docker Desktop starts.
- Check: `docker compose ps` (all `healthy`/`running`), and `https://workspace.uncanned.in/api/health`.
- Logs: `docker compose logs -f app` (rotated, max 50 MB).

---

## B. Railway

1. New project → **Deploy from GitHub repo** (push this repo first) → service root directory `web` (it has a Dockerfile).
2. Add a **PostgreSQL** database. In the app service's variables set `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Add a **Volume** to the app service mounted at `/data/uploads`. Without it, uploads are lost on redeploy.
4. Variables: `APP_URL` (the Railway or custom domain), `BETTER_AUTH_SECRET`, `APP_TIMEZONE`, and the SMTP settings.
5. Custom domain: Railway → Settings → Domains → `workspace.uncanned.in`, then add the CNAME it shows in Cloudflare (DNS only, grey cloud).
6. First admin: Railway → app service → "Run command": `node dist/setup.cjs --workspace "Uncanned" --email you@uncanned.in --name "Your Name"` with `ADMIN_PASSWORD` set as a variable for that run.
7. Backups: Railway's Postgres has its own backups on paid plans. To keep **your own** encrypted off-site copies, run the `backup/` image as a second Railway service with `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` from the Postgres service and the uploads volume mounted.

Migrations run automatically every time the app container starts.

---

## C. VPS (later, always-on)

Same as option A on an Ubuntu 24.04 server: install Docker, copy the repo and `.env`, then run
`docker compose --profile tunnel up -d --build`. With the tunnel, the only open ports are SSH,
and SSH should be key-only. Run `ufw allow OpenSSH && ufw enable`, and turn on `unattended-upgrades`.

---

## Upgrades and rollback

```sh
docker compose exec backup /scripts/backup.sh       # 1. fresh backup
git pull                                            # 2. new code
docker compose up -d --build                        # 3. rebuild; migrations run on start
docker compose logs -f app                          # 4. watch for "Migrations applied."
```
Rollback: `git checkout <previous tag>`, then `docker compose up -d --build`. If the new version
changed the database, restore the backup from step 1 (see BACKUP-RESTORE.md).
Migrations are additive by design. A destructive one is called out in the release notes and
needs a backup first.

## Troubleshooting

| Symptom | Check |
|---|---|
| Site unreachable from outside | `docker compose ps cloudflared`; tunnel status in the Cloudflare dashboard; laptop asleep? |
| "Couldn't reach the server" in the app | `docker compose logs app`; `curl http://localhost:3000/api/health` |
| Sign-in loops back to login | `APP_URL` must exactly match the address in the browser (https and hostname) |
| Emails not arriving | App password correct? Admins can still copy links from Settings → Members |
| Disk filling up | `docker system df`; old backups in `./backups` (kept `BACKUP_KEEP_DAYS` days) |
