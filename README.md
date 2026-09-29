# Indie Community Bot

A Discord bot built for indie game communities: welcome cards for new members, announcements and devlogs, build notifications from your CI pipeline, bug reports as private threads, self-assignable roles, and bilingual publishing — all configured per server, with no code changes needed to add a second community.

Built to serve one game well and be reused for the next one without a fork: everything server-specific lives in the database, so a second community is a second row.

```
Node 24 · TypeScript · discord.js v14 · SQLite (node:sqlite) · Docker
```

---

## Two ways to run it

This repository actually ships **two implementations of the same bot**, because the features split cleanly into two groups depending on how Discord delivers them:

- **Slash commands, buttons and modals** (announcements, devlogs, builds, bug reports, self-roles, `/config`) arrive as an HTTP request the instant someone uses them. Discord can deliver these to a plain web endpoint that only wakes up on demand.
- **"Someone joined the server" and "a role was deleted"** are different: Discord only announces these over the **gateway**, a WebSocket connection that has to stay open all the time. There is no HTTP equivalent — if nothing is listening on that live connection at the moment it happens, the event is simply never seen.

That second category is exactly the welcome card and the automatic role on join. This is what people usually mean when they say "the welcomer needs a server with an open connection" — technically it is a persistent WebSocket (the *gateway*), not a webhook, but the practical consequence is the same: it needs a process that is **always running**, not a platform that spins up per request.

So:

| | `src/` — the full bot | `worker/` — the serverless bot |
|---|---|---|
| Runs on | Any machine that stays on (VPS, home PC, Raspberry Pi) | Cloudflare Workers — free, no server to maintain |
| Connects to Discord via | The gateway (a persistent WebSocket) | HTTP interactions only (wakes up per request) |
| Welcome card + auto-role on join | ✅ | ❌ *(Discord never delivers the join event this way)* |
| Everything else — commands, buttons, modals, CI builds | ✅ | ✅, identical behaviour |

Both share the same database schema, the same translated strings, and the same slash command definitions, so switching later costs nothing but redeploying (see [Moving to a server later](docs/HOSTING-CLOUDFLARE.md#moving-to-a-server-later)).

---

## Features

### 🖼️ Welcome cards *(needs the always-on bot — see above)*
When a new member joins, the bot renders a PNG on the fly with their avatar, a username, the game's accent colour, and optional background artwork — then posts it to your welcome channel and, optionally, hands out a role automatically. Artwork and the font are swappable per install with no code changes (`assets/welcome/`, `assets/fonts/`), and each server can override the background with its own image via `/welcome background`. `/welcome test` renders one on demand so you can iterate on the design without waiting for a real join.

### 📣 Announcements & devlogs
`/announce` and `/devlog` open a Discord **modal** — a real multi-line text form, instead of a cramped slash-command option. Devlogs are numbered automatically per server. Both support an optional `@everyone`/`@here` ping and post to whichever channel you've configured.

### 🚀 Build notifications
Announce a new build two ways that produce an **identical** message: run `/build announce` by hand, or have your CI pipeline `POST /hooks/build` after a successful deploy (GitHub Actions, Steam, itch.io — see [BUILD-NOTIFICATIONS.md](docs/BUILD-NOTIFICATIONS.md)). Both call the same underlying function, so there's no second code path to drift out of sync. Re-running a CI job that already announced a build is a safe no-op — duplicates are detected and skipped. `/build latest` and `/build list` show history.

### 🐛 Bug reports
A panel with a **"Report a bug"** button opens a modal; submitting it creates a numbered, **private thread** per report with an embed and Claim / Close (with a resolution note) / Reopen buttons. Nothing is public by default, so reporters can share logs or screenshots without spamming the whole server. `/bug list` and `/bug stats` give staff an overview.

### 🌍 Bilingual publishing
Set a primary and an optional second language per server (`/config general`). With both set, every **public** post — announcements, devlogs, the bug panel, the welcome message — renders in both languages, as one embed per language in a single message, so nobody has to pick a "wrong" channel. **Private replies work differently**: an ephemeral response (confirmations, errors, `/config check`) automatically follows *each individual viewer's own* Discord client language, regardless of the server's configured languages — and a bug report thread keeps speaking whatever language the reporter used to open it. Locale files are TypeScript, type-checked against each other, so a missing translation is a compile error rather than a blank string in production.

### 🎨 Per-server identity
The bot can wear a different avatar, banner and nickname in every community it serves (`/config branding`), using Discord's own per-guild bot profile — distinct from its one global identity in the Developer Portal. One deployment, one process, one database, but it doesn't look like the same bot copy-pasted across servers.

### 🏷️ Self-assignable roles
`/selfrole panel` posts a button panel (up to 25 roles) that members click to opt themselves into a role — build-alert pings, playtester, platform, language — and click again to remove it. No moderator has to hand these out by hand, and every role on the panel is checked up front for hierarchy/permission problems rather than failing silently when someone clicks.

### 🔒 Role-based access
By default, each command is gated by a single Discord permission (e.g. `/announce` needs *Manage Messages*), which is coarse — that same permission covers a dozen unrelated abilities. `/access` narrows any command, or the whole bot, to specific roles you name, enforced in one place so no command can forget the check. Administrators and the server owner always pass, so a misconfigured rule can never lock you out of your own server.

### ♻️ Multi-server from day one
No server ID, channel ID or role ID is hardcoded anywhere. Every setting lives in the database per guild, so inviting the bot to a second community is `/config` and nothing else — no redeploy, no fork, no environment change.

---

## Quick start

```bash
npm install
cp .env.example .env        # then fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm run commands:deploy     # register the slash commands
npm run dev
```

Full walkthrough — creating the Discord app, intents, the invite URL, first configuration: **[docs/SETUP.md](docs/SETUP.md)**.

Then, in your server:

```
/config channels welcome:#welcome announcements:#news builds:#builds bugs:#bugs
/config general language:Español second_language:English game_name:"Your Game" accent_color:#FF5C00
/config check
/bug panel
```

`/config check` verifies every channel, role and permission and tells you exactly what is missing. Run it first whenever something is not posting.

## Preview the welcome card without Discord

```bash
npm run preview:card -- "#FF5C00" "Your Game"
```

Writes samples to `preview/`. `assets/welcome/background.png` (1000×350 or wider) is the default artwork for every server, and a `.ttf` in `assets/fonts/` sets the typeface — no code changes. Individual servers override the artwork at runtime with `/welcome background`.

## Documentation

| | |
|---|---|
| **[SETUP.md](docs/SETUP.md)** | Discord app, intents, invite, first run, command reference, troubleshooting |
| **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** | Develop locally against a test server, push to main, and let the server update itself from GHCR with automatic rollback |
| **[HOSTING-ORACLE.md](docs/HOSTING-ORACLE.md)** | Free 24/7 hosting on Oracle Cloud Always Free — no accidental billing, 4 ARM cores |
| **[HOSTING-GCP.md](docs/HOSTING-GCP.md)** | The same on a Google Cloud e2-micro |
| **[HOSTING-CLOUDFLARE.md](docs/HOSTING-CLOUDFLARE.md)** | No server at all: the serverless variant on Cloudflare Workers + D1, free, minus the welcome card and auto-role on join |
| **[BUILD-NOTIFICATIONS.md](docs/BUILD-NOTIFICATIONS.md)** | Three ways to announce a build, the webhook API, Steam and itch.io |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How the code is organised and why |
| **[PLAN.md](PLAN.md)** | What is built, what is next |
| **[examples/](examples/github-actions/)** | Ready-to-copy workflows for your *game's* repository |

## Scripts

```bash
npm run dev              # hot-reloading development
npm run build            # compile to dist/
npm start                # run the compiled build
npm run commands:deploy  # register slash commands (run after adding/changing one)
npm run commands:clear   # remove all registered commands
npm run preview:card     # render sample welcome cards to preview/
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run format           # prettier
```

## Hosting

Pick based on whether the welcome card and auto-role on join matter to you, and whether you have (or want) a machine that stays on:

| | [Cloudflare Workers](docs/HOSTING-CLOUDFLARE.md) | [Oracle Cloud Always Free](docs/HOSTING-ORACLE.md) | [Google Cloud Always Free](docs/HOSTING-GCP.md) |
|---|:---:|:---:|:---:|
| Cost | $0, and the free plan cannot bill you | $0, hard-blocked from billing until you opt in | $0 within the allowance — watch region/disk type |
| Needs a server you maintain | ❌ — fully serverless | ✅ — a VM you patch and monitor | ✅ — a VM you patch and monitor |
| Setup effort | Low — `wrangler deploy` and a few secrets | Medium — VM, Docker, SSH deploy key | Medium — VM, Docker, SSH deploy key |
| Slash commands, buttons, modals | ✅ | ✅ | ✅ |
| Bug tickets, self-roles, announcements, devlogs | ✅ | ✅ | ✅ |
| Build notifications (`/build`, CI webhook) | ✅ | ✅ | ✅ |
| **Welcome card on join** | ❌ *(needs the gateway — see [above](#two-ways-to-run-it))* | ✅ | ✅ |
| **Automatic role on join** | ❌ *(same reason)* | ✅ | ✅ |
| Machine specs | None — Cloudflare's free plan | 4 ARM cores, 24 GB RAM | 1 shared vCPU, 1 GB RAM |

**No server, and you don't need the welcome card?** Cloudflare Workers is the easiest path — see [HOSTING-CLOUDFLARE.md](docs/HOSTING-CLOUDFLARE.md). It runs everything except the join features, for free, with no machine to patch or monitor.

**Want the welcome card and auto-role?** You need the always-on variant, which means a machine that stays on. It only needs to be modest — **~125 MB resident**, one core, a disk that survives a reboot — so a free cloud VM easily covers it: [HOSTING-ORACLE.md](docs/HOSTING-ORACLE.md) (more headroom, ARM) or [HOSTING-GCP.md](docs/HOSTING-GCP.md) (smaller, x86). An old mini PC, a laptop or a Raspberry Pi at home works too — the bot only makes *outbound* connections, so it needs no static IP, no port forwarding and no domain.

It ships as a Docker container with one volume, so nothing here is provider-specific; the image is published for both `amd64` and `arm64`.

```bash
docker compose up -d --build     # local
```

You can also start on Cloudflare and move to a server later without losing your settings — see [Moving to a server later](docs/HOSTING-CLOUDFLARE.md#moving-to-a-server-later).

## Configuration

Two layers, deliberately separated:

- **`.env`** — process-level and secret: token, database path, webhook secret. Set once per deployment.
- **`/config`** — everything server-specific: channels, roles, language, game name, accent colour. Stored in SQLite, changed at runtime, different per server.

Adding the bot to a second server needs no redeploy and no environment change.

## License

MIT
