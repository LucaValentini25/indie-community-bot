# Hosting on Google Cloud (Always Free e2-micro)

Running this bot 24/7 for $0/month on Google Cloud's Always Free tier, with automatic deploys from GitHub.

> **Check the current terms before you start.** Free-tier limits change. At the time of writing the Always Free allowance is one `e2-micro` VM in `us-west1`, `us-central1` or `us-east1`, 30 GB of standard persistent disk, and 1 GB of egress to North America per month. Confirm at <https://cloud.google.com/free/docs/free-cloud-features#compute>.
>
> Staying inside the allowance matters: a VM in the wrong region, or an SSD instead of a standard disk, quietly becomes a paid VM. Set a **budget alert at $1** (Billing → Budgets & alerts) so you find out immediately if something falls outside it.

---

## What you are building

```
GitHub push to main
   │
   ├─► Actions: build Docker image ──► GHCR (ghcr.io/you/bot:latest)
   │
   └─► Actions: ssh to the VM ──► docker compose pull && up -d
                                     │
                                     └─► container ──► Discord gateway (outbound)
                                              │
                                              └─► /data/bot.db on a Docker volume
```

The VM never compiles anything. With 1 GB of RAM, `npm ci` plus `tsc` there is slow at best and an OOM kill at worst, so GitHub's runners build the image and the VM only pulls it.

---

## 1. Create the VM

Console → **Compute Engine → VM instances → Create instance**:

| Field | Value | Why |
|---|---|---|
| Name | `discord-bot` | |
| Region | `us-central1` (or `us-west1` / `us-east1`) | **Only these qualify for Always Free** |
| Machine type | `e2-micro` | The free shape |
| Boot disk | Debian 12, **Standard persistent disk**, 30 GB | Balanced/SSD disks are **not** free |
| Firewall | Leave both HTTP/HTTPS **unchecked** for now | Open them only if you expose the build webhook |

Or with `gcloud`:

```bash
gcloud compute instances create discord-bot \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard
```

## 2. Prepare the machine

SSH in from the console (**SSH** button next to the instance), then:

```bash
# Swap. 1 GB of RAM is enough to RUN the bot but leaves no headroom — swap is
# what stops an occasional spike from OOM-killing the container.
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker

# Unattended security updates
sudo apt-get update
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

docker --version && free -h
```

## 3. Set up the bot directory

```bash
mkdir -p ~/discord-bot && cd ~/discord-bot
```

Create two files. First `docker-compose.prod.yml` — copy it from this repo and **replace `OWNER/REPO`** with your GitHub repository, lowercase:

```bash
curl -o docker-compose.prod.yml \
  https://raw.githubusercontent.com/OWNER/REPO/main/docker-compose.prod.yml
sed -i 's|ghcr.io/OWNER/REPO|ghcr.io/owner/repo|' docker-compose.prod.yml
```

Then `.env`:

```bash
cat > .env <<'EOF'
DISCORD_TOKEN=your-token
DISCORD_CLIENT_ID=your-application-id
NODE_ENV=production
LOG_LEVEL=info
DEFAULT_LOCALE=en
WEBHOOK_SECRET=paste-a-long-random-hex-string
EOF

chmod 600 .env
```

Generate the secret with `openssl rand -hex 32`.

> Leave `DISCORD_DEV_GUILD_ID` unset in production so commands register globally.

## 4. Give the VM access to the image

GHCR needs a token even for public images when pulling non-interactively.

1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)** → generate one with only the **`read:packages`** scope.
2. On the VM:

```bash
echo "YOUR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

## 5. Wire up automatic deploys

On the VM, create a key pair for GitHub Actions:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions -N ""
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_actions          # ← the PRIVATE key; copy all of it
```

In the bot repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | The VM's external IP |
| `DEPLOY_USER` | Your Linux username on the VM (`whoami`) |
| `DEPLOY_SSH_KEY` | The **private** key printed above, including the `BEGIN`/`END` lines |
| `GHCR_TOKEN` | The `read:packages` PAT from step 4 |

Optionally add a repository **variable** `DEPLOY_COMMANDS = true` to re-register slash commands on every deploy. Leave it off unless you change commands often — it is an extra API call per deploy for no benefit otherwise.

Push to `main`, or run the **Deploy** workflow by hand from the Actions tab.

## 6. First start

```bash
cd ~/discord-bot
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

docker compose -f docker-compose.prod.yml logs -f       # watch it connect
curl -s http://127.0.0.1:8080/health                    # {"status":"ok",...}
```

Register the slash commands once:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps bot node dist/scripts/deploy-commands.js
```

---

## Exposing the build webhook (only if you use `notify-bot.yml`)

The container binds to `127.0.0.1` on purpose. To let GitHub Actions reach `POST /hooks/build` you need a domain and TLS. **Never** open port 8080 to the internet directly — that would send the shared secret in plaintext.

Point an A record at the VM's IP, then:

```bash
# Allow HTTP/HTTPS
gcloud compute firewall-rules create allow-web \
  --allow tcp:80,tcp:443 --target-tags=http-server,https-server
gcloud compute instances add-tags discord-bot \
  --zone=us-central1-a --tags=http-server,https-server

# Caddy: obtains and renews a Let's Encrypt certificate on its own
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
bot.yourdomain.com {
    # Only the two routes the bot actually serves.
    @allowed path /hooks/build /health
    handle @allowed {
        reverse_proxy 127.0.0.1:8080
    }
    handle {
        respond 404
    }
}
EOF

sudo systemctl reload caddy
curl -s https://bot.yourdomain.com/health
```

Your `BOT_WEBHOOK_URL` secret in the game repo is then `https://bot.yourdomain.com/hooks/build`.

**If you would rather skip all of this:** use `examples/github-actions/notify-discord-webhook.yml`, which posts straight to a Discord webhook and needs no exposed port, no domain and no certificate. You lose the build history in `/build latest` and `/build list`, and that is the whole trade-off.

---

## Backups

The database is the only state. Everything else is rebuilt from the repo.

```bash
mkdir -p ~/backups

cat > ~/backup-bot.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)

# Uses SQLite's VACUUM INTO, which is safe against a live database. Copying a
# WAL-mode .db file while it is being written can produce a torn backup.
docker exec indie-community-bot node dist/scripts/backup.js /data/backup.db
docker cp indie-community-bot:/data/backup.db ~/backups/bot-$STAMP.db
docker exec indie-community-bot rm -f /data/backup.db

find ~/backups -name 'bot-*.db' -mtime +14 -delete
EOF

chmod +x ~/backup-bot.sh
(crontab -l 2>/dev/null; echo "0 4 * * * $HOME/backup-bot.sh >> $HOME/backup.log 2>&1") | crontab -
```

To restore: stop the container, `docker cp` a backup to `/data/bot.db`, start it again.

For off-machine copies, `gsutil rsync ~/backups gs://your-bucket/` fits comfortably in the free 5 GB of Cloud Storage.

---

## Day-to-day

```bash
cd ~/discord-bot
C="docker compose -f docker-compose.prod.yml"

$C logs -f --tail=100      # follow logs
$C restart bot             # restart
$C ps                      # status and health
$C pull && $C up -d        # update to the latest image manually

docker exec -it indie-community-bot sh    # shell inside the container
free -h && df -h /                        # memory and disk
```

**Rollback.** Every deploy also tags the image with the commit SHA:

```bash
docker pull ghcr.io/owner/repo:GOOD_SHA
docker tag  ghcr.io/owner/repo:GOOD_SHA ghcr.io/owner/repo:latest
docker compose -f docker-compose.prod.yml up -d
```

**Uptime monitoring.** Point a free monitor (UptimeRobot, Better Stack) at `https://bot.yourdomain.com/health` if you exposed it. If you did not, `docker compose ps` showing `healthy` plus `restart: unless-stopped` is a reasonable floor — the container restarts itself on crash.

---

## Moving somewhere else

Nothing here is Google-specific. On any other Docker host:

1. Copy `docker-compose.prod.yml` and `.env`.
2. Restore `bot.db` into the `bot-data` volume.
3. `docker compose -f docker-compose.prod.yml up -d`.
4. Update `DEPLOY_HOST` in the repo secrets.

Same steps for Oracle Cloud's Always Free ARM instance — the only change is building the image for `linux/arm64` (add `platforms: linux/arm64` to the `build-push-action` step in `.github/workflows/deploy.yml`).
