# Hosting on Oracle Cloud (Always Free Ampere A1)

Running this bot 24/7 for $0/month on Oracle Cloud's Always Free tier, with automatic deploys from GitHub.

Compared to [HOSTING-GCP.md](HOSTING-GCP.md) the trade is: far more machine (4 ARM cores and 24 GB of RAM against 1 shared vCPU and 1 GB), no charge for the public IPv4, and an account that **cannot** bill you — against ARM images and a sign-up where capacity is the hard part.

> **Check the current terms before you start.** At the time of writing Always Free includes 4 OCPU and 24 GB of RAM of `VM.Standard.A1.Flex` (Ampere, ARM64), two `VM.Standard.E2.1.Micro` (AMD) instances, 200 GB of block storage and **10 TB of egress per month**. Confirm at <https://www.oracle.com/cloud/free/>.
>
> A Discord bot uses a rounding error of that 10 TB. There is no realistic way to grow out of this allowance.

## Why you will not be charged by accident

Worth understanding before you hand over a card, because it is the part that differs most from Google:

- The card is charge-verified for identity only. You start on a 30-day trial with $300 of credit.
- When the trial ends the account converts to **Always Free**. An Always Free account has *no ability to provision paid resources* — the console refuses them. It is a hard block, not a soft limit you can overrun.
- The only way to spend money is to press **Upgrade to Paid Account** yourself.

Two consequences worth planning for:

1. **Idle instances get reclaimed.** In an Always Free account, Oracle may stop a compute instance whose 95th-percentile CPU, network *and* memory utilisation all stay under 20% over 7 days. You get an email first, and it is a **stop**, not a terminate — the boot volume and the database survive, and the instance restarts with one click. But it will not restart itself, so the bot is down until you notice. See [Surviving reclamation](#surviving-reclamation).
2. **Paid accounts are exempt from reclamation**, and Always Free resources stay free inside a paid account. Many people upgrade purely for that. If you do, set a **$1 budget alert** (Billing → Budgets) immediately, because the hard block is gone.

---

## What you are building

```
GitHub push to main
   │
   ├─► Actions: build arm64 image ──► GHCR (ghcr.io/you/bot:latest)
   │
   └─► Actions: ssh to the VM ──► docker compose pull && up -d
                                     │
                                     └─► container ──► Discord gateway (outbound)
                                              │
                                              └─► /data/bot.db on a Docker volume
```

Identical to the GCP setup except the image is built for `linux/arm64`. Ampere is ARM; an amd64 image will not start on it.

---

## 1. Create the account

<https://www.oracle.com/cloud/free/> → **Start for free**.

**The home region is permanent — choose it deliberately.** You cannot change it later, and Always Free resources only ever exist in it.

Choose it for **A1 capacity, not for latency.** Latency is the intuitive criterion and it is the wrong one here: the bot is an outbound WebSocket client to Discord's US-East infrastructure, so it sits 120–150 ms from Discord no matter which South American region hosts it, and Discord's budget for acknowledging an interaction is three seconds (fifteen minutes once you `deferReply`). Tens of milliseconds against a three-second margin decide nothing. A US region would cut that to single digits — and `us-ashburn-1` and `us-phoenix-1` are exactly where A1 capacity is hardest to get, so it trades the thing that matters for the thing that does not.

Capacity, meanwhile, tracks how large and how old a region is. Bigger and older means more contended:

| Region | |
|---|---|
| `sa-santiago-1` (Chile Central) | Good default from the Southern Cone: a small OCI market, so little contention, but long-established enough that Always Free A1 is a sure thing |
| `sa-vinhedo-1` (Brazil Southeast) | Just as good — it exists to relieve São Paulo |
| `sa-valparaiso-1` (Chile West) | Best odds on capacity as the newest, least proven that it offers free A1 at all |
| `sa-saopaulo-1` (Brazil East) | The big South American region, and the most saturated of the four |

If your first choice fails at step 2 for days on end, a second account with a different home region is the usual fix — a wrong pick costs annoyance, not the project.

Sign-up takes a card and a phone number and is usually approved in a few minutes.

## 2. Create the VM

Menu → **Compute → Instances → Create instance**:

| Field | Value | Why |
|---|---|---|
| Name | `discord-bot` | |
| Image | **Canonical Ubuntu 24.04** | The commands below assume Ubuntu (`apt`, user `ubuntu`) |
| Shape | **Ampere → `VM.Standard.A1.Flex`**, 4 OCPU / 24 GB | ARM64. Look for the *Always Free-eligible* label |
| Networking | Create a new VCN, **Assign a public IPv4 address: yes** | Free here, unlike on GCP |
| SSH keys | Paste your public key (`~/.ssh/id_ed25519.pub`) | Oracle does not offer password login |
| Boot volume | Leave the default (~47 GB) | Free tier gives 200 GB total across all volumes |

Then **Create**, and note the public IP on the instance page.

### If you get "Out of host capacity"

This is the one genuinely painful part of Oracle, and it is not a problem with your account. In order of what to try:

1. **Switch availability domain** in the create dialog and retry — ADs hold independent capacity. Only helps in a multi-AD region, which in practice means `us-ashburn-1`, `us-phoenix-1`, `eu-frankfurt-1` and `uk-london-1`; most others, the South American ones included, have a single AD and will not offer the choice.
2. **Ask for less.** 1 OCPU / 6 GB frequently succeeds where 4/24 fails, and is still far more than this bot needs. You can grow the shape later, when capacity frees up, without rebuilding.
3. **Retry on a schedule.** Capacity is released continuously; people commonly get in within a day or two of periodic retries.
4. **Fall back to `VM.Standard.E2.1.Micro`** (AMD, 1 OCPU / 1 GB). Always available, and identical in size to the GCP e2-micro. If you take this route the image must be **amd64**, so skip the ARM change in step 6 — and add the swap file from [HOSTING-GCP.md § 2](HOSTING-GCP.md#2-prepare-the-machine), because 1 GB has no headroom.

## 3. Prepare the machine

```bash
ssh ubuntu@YOUR_PUBLIC_IP
```

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker

# Unattended security updates
sudo apt-get update
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

docker --version && free -h && uname -m     # expect aarch64
```

No swap file is needed — 24 GB is more RAM than this bot will ever ask for. Docker's own systemd unit is enabled by `get.docker.com`, so together with `restart: unless-stopped` in the compose file the bot comes back on its own after any reboot.

> **Oracle's Ubuntu images ship a restrictive iptables ruleset** that permits little beyond SSH, *in addition to* the VCN security lists. You do not need to touch either one for the bot itself — it only makes outbound connections and binds to `127.0.0.1`. It matters only if you expose the build webhook; see below.

## 4. Set up the bot directory

```bash
mkdir -p ~/discord-bot && cd ~/discord-bot

curl -o docker-compose.prod.yml \
  https://raw.githubusercontent.com/OWNER/REPO/main/docker-compose.prod.yml
sed -i 's|ghcr.io/OWNER/REPO|ghcr.io/owner/repo|' docker-compose.prod.yml
```

Then `.env` — paste this as a single block, ending with the lone `EOF` line:

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

Generate the secret with `openssl rand -hex 32`. Leave `DISCORD_DEV_GUILD_ID` unset so commands register globally.

## 5. Give the VM access to the image

GHCR needs a token even for public images when pulling non-interactively.

1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)** → generate one with only the **`read:packages`** scope.
2. On the VM:

```bash
echo "YOUR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

## 6. Build the image for ARM

`.github/workflows/deploy.yml` builds `linux/amd64,linux/arm64` and emulates the foreign architecture with QEMU, so it works for both this guide and the GCP one out of the box. Nothing to change.

If Oracle is your only target, the build gets substantially faster by dropping the emulation — build natively on GitHub's ARM runners instead:

```yaml
  build:
    runs-on: ubuntu-24.04-arm      # was: ubuntu-latest
    # ...
      # delete the "Set up QEMU" step
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          platforms: linux/arm64   # was: linux/amd64,linux/arm64
```

ARM runners are free for public repositories; private repositories need a paid GitHub plan. On the free plan for a private repo, keep QEMU.

The runtime dependencies are all ARM-ready: `@napi-rs/canvas` ships a `linux-arm64-gnu` prebuild, so the welcome cards render without compiling anything, and `node:sqlite` is built into Node itself.

## 7. Wire up automatic deploys

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
| `DEPLOY_HOST` | The instance's public IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | The **private** key printed above, including the `BEGIN`/`END` lines |
| `GHCR_TOKEN` | The `read:packages` PAT from step 5 |

Push to `main`, or run the **Deploy** workflow by hand from the Actions tab.

## 8. First start

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

If the container exits immediately with `exec format error`, the image is amd64 and the machine is ARM — revisit step 6.

---

## Surviving reclamation

Two independent problems: knowing that it happened, and making it less likely.

### Know within minutes

The container restarts itself on crash and after a reboot, so the failure mode that actually leaves the bot down is the instance being stopped — and a stopped instance cannot tell you anything. Use a dead-man's switch: something outside the VM that alerts when the VM *stops* reporting.

Create a check at <https://healthchecks.io> (free), then on the VM:

```bash
cat > ~/ping-health.sh <<'EOF'
#!/usr/bin/env bash
# Only pings if the bot itself is healthy, so this catches a wedged container
# as well as a stopped instance.
curl -fsS --max-time 10 http://127.0.0.1:8080/health >/dev/null \
  && curl -fsS --max-time 10 https://hc-ping.com/YOUR-UUID >/dev/null
EOF

chmod +x ~/ping-health.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * $HOME/ping-health.sh") | crontab -
```

Set the check's period to 5 minutes with a 15-minute grace. Missing pings mail you, and it needs no open ports, no domain and no certificate.

### Make it less likely

Reclamation needs CPU, network **and** memory to all sit under 20% at the 95th percentile over 7 days. On a 4 OCPU / 24 GB shape a Discord bot is nowhere near any of them, so an Always Free A1 is a genuine candidate.

- **The reliable fix is upgrading to a paid account.** Reclamation does not apply to them, and the Always Free resources stay free. Pair it with a $1 budget alert.
- Requesting a *smaller* shape (1 OCPU / 6 GB) also helps, because the same absolute usage is a larger percentage of it.
- Artificially burning CPU to stay above the threshold works but wastes power for the sake of a rule; the dead-man's switch above is a better use of the effort.

In practice reports vary widely — plenty of bots run for years untouched. With the switch in place the worst case is a few minutes of downtime and one click on **Start** in the console.

---

## Exposing the build webhook (only if you use `notify-bot.yml`)

The container binds to `127.0.0.1` on purpose. To let GitHub Actions reach `POST /hooks/build` you need a domain and TLS. **Never** open port 8080 to the internet directly — that would send the shared secret in plaintext.

Oracle has **two** firewalls and both must be opened, which is the usual reason this appears not to work.

**1. The VCN security list.** Instance page → the VCN's subnet → its Security List → **Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination ports `80,443`.

**2. The instance's own iptables.** Oracle's Ubuntu images block them locally as well:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save        # survives reboot
```

Point an A record at the public IP, then install Caddy, which obtains and renews a Let's Encrypt certificate on its own:

```bash
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

**If you would rather skip all of this:** use `examples/github-actions/notify-discord-webhook.yml`, which posts straight to a Discord webhook and needs no exposed port, no domain and no certificate.

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

Always Free includes 20 GB of Object Storage; `oci os object bulk-upload --bucket-name backups --src-dir ~/backups` puts copies off the machine.

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

---

## Moving somewhere else

Nothing here is Oracle-specific. On any other Docker host:

1. Copy `docker-compose.prod.yml` and `.env`.
2. Restore `bot.db` into the `bot-data` volume.
3. `docker compose -f docker-compose.prod.yml up -d`.
4. Update `DEPLOY_HOST` in the repo secrets.

The image is already built for both architectures, so an x86 host needs no change.
