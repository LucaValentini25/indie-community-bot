# Deployment: develop locally, push to main, the server updates itself

```
                    your machine                          the server
                 ┌─────────────────┐                 ┌────────────────┐
  branch dev  ──►  │ npm run dev      │                 │                │
                 │ the dev bot      │                 │                │
                 └───────┬─────────┘                 │                │
                         ▼                                │                │
                 a test Discord server                     │                │
                                                           │                │
  branch main ─►  Actions builds ─► ghcr.io/…:latest ─►  │ polls, updates │
                                                           └────────┬───────┘
                                                                    ▼
                                                          the real Discord server
```

You work on `dev` and run the bot on your own machine against a throwaway
Discord server. When a feature holds up, you merge to `main`; the server picks
the new image up on its own within a couple of minutes — no SSH, nothing
exposed to the internet, and an automatic rollback if it does not come up
healthy.

The server only ever runs `main`. That is why `deploy.yml` publishes only
`:latest`: a `:dev` image would be built by a slow multi-arch job and pulled by
nobody. `ci.yml` still builds the image on `dev` without pushing it, so a
broken Dockerfile is caught before it reaches `main`.

> **Running dev on the server too?** Add `dev` back to the branches in
> `deploy.yml` and follow [Two instances on one server](#two-instances-on-one-server)
> at the end. Everything else is identical.

---

## The part that catches everybody: you need two Discord applications

Not two servers — two **applications**, each with its own token.

A bot token is one identity holding one gateway connection. Run the same token
in two places and both instances receive every event from every server they are
in, and both answer: two welcome cards, two replies to a slash command, two
threads per bug report. It is not a configuration you can tune around; the
token is the identity.

So, in the [Developer Portal](https://discord.com/developers/applications),
create a second application alongside the real one:

| | Development | Production |
|---|---|---|
| Application | `Your Game Bot (dev)` | `Your Game Bot` |
| Runs on | your machine, `npm run dev` | the server, in Docker |
| Invited to | a throwaway server you own | the real community |
| Token lives in | `.env` in your working copy | `/opt/bot-prod/.env` |
| `DISCORD_DEV_GUILD_ID` | the test server's id | **unset** — commands register globally |

Both need the **Server Members Intent** enabled (Bot → Privileged Gateway
Intents). It is easy to remember for the real one and easy to forget for the
test one, and forgetting it means welcome cards silently never fire — exactly
the bug the test server exists to catch.

**`DISCORD_DEV_GUILD_ID` is why dev is pleasant to work with.** Set it, and
slash commands register to that one server and appear instantly. Leave it unset
in production and they register globally, which is correct but takes up to an
hour to propagate. Same code, different environment variable.

---

## Part 1 — Your machine

```bash
cp .env.example .env
```

Fill in the **development** application's token and id, and your test server's
id (Discord → enable Developer Mode, then right-click the server → Copy Server
ID):

```ini
DISCORD_TOKEN=the-development-token
DISCORD_CLIENT_ID=the-development-application-id
DISCORD_DEV_GUILD_ID=your-test-server-id
DEFAULT_LOCALE=es
```

Then:

```bash
npm install
npm run commands:deploy   # registers the slash commands to the test server
npm run dev               # starts the bot with hot reload
```

`commands:deploy` is not automatic. Run it again whenever you add a command,
rename one, or change its options — editing what a command *does* only needs a
restart, which `npm run dev` does for you.

The `BOT_INSTANCE`, `BOT_CHANNEL` and `HOST_PORT` entries in `.env.example` are
read only by `docker-compose.prod.yml` on a server. Ignore them here.

---

## Part 2 — The server

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

## 3. Create the instance

```bash
sudo mkdir -p /opt/bot-prod
sudo chown "$USER" /opt/bot-prod

# Your repository, lowercase: GHCR rejects uppercase, and GitHub usernames
# often have some.
GHCR_REPO="your-username/indie-community-bot"

curl -o /opt/bot-prod/docker-compose.prod.yml   "https://raw.githubusercontent.com/$GHCR_REPO/main/docker-compose.prod.yml"
sed -i "s|ghcr.io/OWNER/REPO|ghcr.io/$GHCR_REPO|" /opt/bot-prod/docker-compose.prod.yml
```

While the repository is private `raw.githubusercontent.com` will not serve that file. Either copy it across with `scp` or make the repository public first.

Now `.env`, with the **production** application's token. Paste it as one block, ending with the lone `EOF`:

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

Generate the secret with `openssl rand -hex 32`.

**Leave `DISCORD_DEV_GUILD_ID` out.** Here it must be unset so commands register globally; setting it would confine the real bot's commands to one server.

## 4. Install the updater

```bash
sudo cp deploy/update-bot.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/update-bot.sh
sudo cp deploy/bot-update@.service deploy/bot-update@.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now bot-update@prod.timer
```

That is the whole mechanism. Every two minutes the timer asks GHCR whether `:latest` points at a new digest; almost always the answer is no and it exits immediately.

The units are templates, so `@prod` is what binds this one to `/opt/bot-prod`. A second instance is the same two files with a different name after the `@`.

Strongly recommended, since the point of this is not having to watch it — a Discord webhook to be told when a deploy fails:

```bash
# Discord: channel settings → Integrations → Webhooks → New Webhook → copy URL
echo 'DEPLOY_WEBHOOK=https://discord.com/api/webhooks/...' | sudo tee /opt/bot-prod/deploy.env
sudo chmod 600 /opt/bot-prod/deploy.env
```

## 5. First start and command registration

```bash
cd /opt/bot-prod
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f      # watch it connect
```

Register the slash commands. This does not happen on start, so run it again after adding or renaming one:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps bot node dist/scripts/deploy-commands.js
```

Because `DISCORD_DEV_GUILD_ID` is unset here, these register globally and can take up to an hour to appear.

---

## The day-to-day loop

```bash
git switch -c my-feature dev
# ... work ...
npm run dev                                        # try it in the test server

git switch dev && git merge my-feature && git push  # CI runs; nothing deploys
git switch main && git merge dev && git push        # the server updates in ~2 min
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
docker tag ghcr.io/$GHCR_REPO:<the-good-sha> ghcr.io/$GHCR_REPO:latest
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

## Two instances on one server

If you would rather run the dev bot on the server than on your own machine —
so it stays up while your laptop is closed — the pieces are already there:

1. Add `dev` back to the branches in `.github/workflows/deploy.yml`, so `:dev`
   gets published.
2. Repeat step 3 for `/opt/bot-dev`, with the **development** token,
   `BOT_CHANNEL=dev`, `HOST_PORT=8081` and `DISCORD_DEV_GUILD_ID` set.
3. `sudo systemctl enable --now bot-update@dev.timer`.

Compose names the volume after the directory, so the two get separate databases
with no further configuration — **the test bot can never write to production
data.** The host ports must differ; the port inside the container is always
8080.

The cost is a slow multi-arch build on every `dev` push, which is why it is not
the default.

## Troubleshooting

**The server never updates.** `systemctl list-timers 'bot-update@*'` to confirm the timer is active, then `journalctl -u bot-update@prod -n 50`. The usual cause is the GHCR login having expired or never been done for that user.

**"denied" pulling the image.** The `read:packages` token was created for a different account than the one that ran `docker login`, or the package is private and the token lacks access.

**Both bots answer every command.** The two `.env` files have the same `DISCORD_TOKEN`, or the dev application was invited to the real server.

**Commands do not appear.** They register on demand, never on start: run `deploy-commands.js` for that application. On production, global commands take up to an hour.

**`exec format error`.** The image architecture does not match the machine. The workflow publishes `amd64` and `arm64`; check `uname -m`.
