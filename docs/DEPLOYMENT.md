# Deployment: a dev branch, a main branch, and a server that updates itself

Two bots, two branches, one machine:

```
push to dev ──► Actions builds ──► ghcr.io/you/bot:dev ─────┐
                                                            │  the server polls
push to main ─► Actions builds ──► ghcr.io/you/bot:latest ──┤  every 2 minutes
                                                            │
                                            /opt/bot-dev  ──┘──► test Discord server
                                            /opt/bot-prod ─────► real Discord server
```

You test on `dev` against a throwaway Discord server. When it works, you merge to `main` and the production bot updates on its own within a couple of minutes — no SSH, nothing exposed to the internet, and an automatic rollback if the new build does not come up healthy.

---

## The part that catches everybody: you need two Discord applications

Not two servers — two **applications**, each with its own token.

A bot token is one identity holding one gateway connection. Run the same token in two places and both instances receive every event from every server they are in, and both answer: two welcome cards, two replies to a slash command, two threads per bug report. It is not a configuration you can tune around; the token is the identity.

So, in the [Developer Portal](https://discord.com/developers/applications), create a second application alongside the real one:

| | Production | Development |
|---|---|---|
| Application | `Your Game Bot` | `Your Game Bot (dev)` |
| Invited to | the real community | a throwaway server you own |
| Token | `DISCORD_TOKEN` in `/opt/bot-prod/.env` | `DISCORD_TOKEN` in `/opt/bot-dev/.env` |
| `DISCORD_DEV_GUILD_ID` | **unset** — commands register globally | the test server's id |

Both need the **Server Members Intent** enabled (Bot → Privileged Gateway Intents). It is easy to remember for the real one and easy to forget for the test one, and forgetting it means welcome cards silently never fire — which is exactly the bug you were hoping to catch on `dev`.

**`DISCORD_DEV_GUILD_ID` is why dev is pleasant to work with.** Set it, and slash commands register to that one server and appear instantly. Leave it unset in production and they register globally, which is correct but takes up to an hour to propagate. Same code, same image, different environment variable.

---

## 1. Prepare the server

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker

# Unattended security updates
sudo apt-get update && sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Docker's own systemd unit is enabled by that installer, so together with `restart: unless-stopped` the bots come back after a reboot or a power cut without anyone logging in.

## 2. Let the server read your images

GHCR needs a token even for public images when pulling non-interactively.

GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)** → generate one with only **`read:packages`**. Then:

```bash
echo "YOUR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

This is the only credential the server needs, and it is read-only. Note the direction: the server pulls from GitHub. GitHub is never given a key to your machine.

## 3. Create the two instances

```bash
sudo mkdir -p /opt/bot-prod /opt/bot-dev
sudo chown "$USER" /opt/bot-prod /opt/bot-dev

for d in prod dev; do
  curl -o "/opt/bot-$d/docker-compose.prod.yml" \
    https://raw.githubusercontent.com/OWNER/REPO/main/docker-compose.prod.yml
  sed -i 's|ghcr.io/OWNER/REPO|ghcr.io/owner/repo|' "/opt/bot-$d/docker-compose.prod.yml"
done
```

Production `.env` — paste as one block, ending with the lone `EOF`:

```bash
cat > /opt/bot-prod/.env <<'EOF'
BOT_INSTANCE=prod
BOT_CHANNEL=latest
HOST_PORT=8080

DISCORD_TOKEN=the-production-token
DISCORD_CLIENT_ID=the-production-application-id
NODE_ENV=production
LOG_LEVEL=info
DEFAULT_LOCALE=es
WEBHOOK_SECRET=paste-a-long-random-hex-string
EOF
chmod 600 /opt/bot-prod/.env
```

Development `.env` — different token, different channel, different port, and `DISCORD_DEV_GUILD_ID` set:

```bash
cat > /opt/bot-dev/.env <<'EOF'
BOT_INSTANCE=dev
BOT_CHANNEL=dev
HOST_PORT=8081

DISCORD_TOKEN=the-development-token
DISCORD_CLIENT_ID=the-development-application-id
DISCORD_DEV_GUILD_ID=your-test-server-id
NODE_ENV=production
LOG_LEVEL=debug
DEFAULT_LOCALE=es
EOF
chmod 600 /opt/bot-dev/.env
```

Generate the secret with `openssl rand -hex 32`. Compose names the volume after the directory, so `/opt/bot-prod` and `/opt/bot-dev` get separate databases with no further configuration — **the test bot can never write to production data.**

## 4. Install the updater

```bash
sudo cp deploy/update-bot.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/update-bot.sh
sudo cp deploy/bot-update@.service deploy/bot-update@.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now bot-update@prod.timer
sudo systemctl enable --now bot-update@dev.timer
```

That is the whole mechanism. Every two minutes each timer asks GHCR whether the tag it follows points at a new digest; almost always the answer is no and it exits immediately.

Strongly recommended, since the point of this is not having to watch it — a Discord webhook to be told when a deploy fails:

```bash
# Discord: channel settings → Integrations → Webhooks → New Webhook → copy URL
echo 'DEPLOY_WEBHOOK=https://discord.com/api/webhooks/...' | sudo tee /opt/bot-prod/deploy.env
sudo chmod 600 /opt/bot-prod/deploy.env
```

## 5. First start and command registration

```bash
cd /opt/bot-prod && docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f      # watch it connect
```

Register the slash commands once per application — this does not happen on start, so a new or renamed command needs it again:

```bash
cd /opt/bot-prod && docker compose -f docker-compose.prod.yml run --rm --no-deps bot node dist/scripts/deploy-commands.js
cd /opt/bot-dev  && docker compose -f docker-compose.prod.yml run --rm --no-deps bot node dist/scripts/deploy-commands.js
```

---

## The day-to-day loop

```bash
git switch -c my-feature dev
# ... work ...
git switch dev && git merge my-feature && git push      # → test bot updates in ~2 min
# ... try it in the test server ...
git switch main && git merge dev && git push            # → real bot updates in ~2 min
```

Watch a rollout:

```bash
journalctl -u bot-update@prod -f
docker logs -f bot-prod
```

Nothing else. `git push` to `main` is the deploy.

## What happens when a deploy is bad

This is the part worth understanding before you trust it, because a server that updates itself unattended can also break itself unattended.

After starting the new image, `update-bot.sh` waits up to two minutes for the container to report **healthy**, and healthy means `/health` answers `status: "ok"` — the gateway is actually connected, not merely that the process is listening. A bad token, a failed migration or a crash on boot all fail this. On failure the old image is re-tagged and restarted, and you get a Discord message saying so.

That is why the outgoing image's **id** is read before pulling, and tagged `:rollback` as soon as an update is confirmed. Pulling moves the `:latest` tag off the old digest, leaving it unreferenced and fair game for `docker image prune` — and then there would be nothing to go back to. Reading the id first and tagging only on a real update also keeps the routine no-op poll from touching anything at all.

The gap it does not cover: a build that starts perfectly and is wrong in a way only a human notices. For that, roll back by hand to any commit — every build is tagged with its SHA:

```bash
cd /opt/bot-prod
docker compose -f docker-compose.prod.yml down
docker tag ghcr.io/owner/repo:<the-good-sha> ghcr.io/owner/repo:latest
docker compose -f docker-compose.prod.yml up -d
```

Then fix `main`. The next poll will pull the fix and overwrite the local tag.

## Why polling and not a push from GitHub

The server reaches out to GHCR; nothing reaches in. That means:

- **No open ports and no port forwarding**, so this works behind a home router, and behind CGNAT where forwarding is not possible at all.
- **No SSH private key in GitHub secrets.** A `DEPLOY_SSH_KEY` is a shell on your machine held by a third party; the read-only `read:packages` token here is not.
- **A changing home IP does not matter**, so no dynamic DNS.

The cost is that a deploy takes up to two minutes instead of being instant, and GitHub Actions cannot report whether it succeeded. For a Discord bot that is a good trade.

If your server *is* publicly reachable on port 22 and you want instant deploys, the workflow still has the SSH path: set the repository variable `DEPLOY_MODE=ssh` and the secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `GHCR_TOKEN`. It runs the same `update-bot.sh`, so the health gate and rollback behave identically. Leave the timers on as a safety net for pushes that happen while the machine is off.

## Backups

The database is the only state; everything else is rebuilt from the repo.

```bash
mkdir -p ~/backups
cat > ~/backup-bot.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
# VACUUM INTO is safe against a live database. Copying a WAL-mode .db file
# while it is being written can produce a torn backup.
docker exec bot-prod node -e "
  const { DatabaseSync } = require('node:sqlite');
  new DatabaseSync('/data/bot.db').exec(\"VACUUM INTO '/data/backup.db'\");
"
docker cp bot-prod:/data/backup.db ~/backups/bot-$STAMP.db
docker exec bot-prod rm -f /data/backup.db
ls -1t ~/backups/bot-*.db | tail -n +15 | xargs -r rm
EOF
chmod +x ~/backup-bot.sh
(crontab -l 2>/dev/null; echo "0 4 * * * $HOME/backup-bot.sh") | crontab -
```

Keeps the last 14 nightly snapshots. Copy them off the machine periodically — a backup on the same disk is not a backup.

## Troubleshooting

**The server never updates.** `systemctl list-timers 'bot-update@*'` to confirm the timer is active, then `journalctl -u bot-update@prod -n 50`. The usual cause is the GHCR login having expired or never been done for that user.

**"denied" pulling the image.** The `read:packages` token was created for a different account than the one that ran `docker login`, or the package is private and the token lacks access.

**Both bots answer every command.** The two `.env` files have the same `DISCORD_TOKEN`, or the dev application was invited to the real server.

**Commands do not appear.** They register on demand, never on start: run `deploy-commands.js` for that application. On production, global commands take up to an hour.

**`exec format error`.** The image architecture does not match the machine. The workflow publishes `amd64` and `arm64`; check `uname -m`.
