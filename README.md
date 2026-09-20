# Indie Community Bot

A Discord bot for indie game communities. Welcome cards, announcements, devlogs, build notifications from CI, and bug reports as private threads.

Built to serve one game well and be reused for the next one without a fork: everything server-specific lives in the database, so a second community is a second row.

```
Node 24 · TypeScript · discord.js v14 · SQLite (node:sqlite) · Docker
```

---

## Features

| | |
|---|---|
| 🖼️ **Welcome cards** | A generated PNG with the member's avatar, the game's accent colour and optional artwork. Plus an automatic role on join. |
| 📣 **Announcements & devlogs** | `/announce` and `/devlog` open a modal — real paragraphs, not a cramped option box. Devlogs are numbered automatically. |
| 🚀 **Build notifications** | `/build announce` by hand, or `POST /hooks/build` from GitHub Actions / Steam CI. Both take the same path, so they look identical. Duplicate announcements are refused, so a re-run is a no-op. |
| 🐛 **Bug reports** | A panel with a button → a modal → a **private thread** per report. Claim, close with a resolution, reopen. Numbered per server. |
| 🌍 **Bilingual** | Set a primary and a second language per server. Public posts render in both — one message, one embed per language. Replies only one person sees follow *their* Discord language automatically. Locales are type-checked against each other, so a missing translation is a compile error. |
| 🎨 **Per-server identity** | The bot wears a different avatar, banner and nickname in each community — Discord's own per-guild profile, so one deployment does not mean one face. |
| 🏷️ **Self-assignable roles** | A button panel where members opt into roles themselves — build pings, playtester, platform, language. Toggling is one click, and nobody has to ask a moderator. |
| 🔒 **Role-based access** | `/access` limits any command to the roles you name — per command, or across the bot. Finer than Discord's own permission checkboxes, and administrators always pass so it cannot lock you out. |
| ♻️ **Multi-server** | No hardcoded IDs. Reuse the same deployment for the next game. |

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
| **[HOSTING-CLOUDFLARE.md](docs/HOSTING-CLOUDFLARE.md)** | No server at all: the serverless variant on Cloudflare Workers + D1, free, minus the welcome card |
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

The full bot holds an open WebSocket to Discord, so it needs a process that stays alive — the welcome card runs on `guildMemberAdd`, which only arrives over that WebSocket.

**No server? Everything except the join features runs free on Cloudflare Workers** — slash commands, bug tickets, the role panel, announcements and CI build notifications, over Discord's HTTP interactions. See [HOSTING-CLOUDFLARE.md](docs/HOSTING-CLOUDFLARE.md). What is left out is the welcome card and the auto-role on join, and moving to a server later loses nothing else.

What it does need is modest: **~125 MB resident**, one core, and a disk that survives a reboot. Any spare machine clears that — an old mini PC, a laptop, a Raspberry Pi. And because it only makes *outbound* connections, running it at home needs no static IP, no port forwarding and no domain.

It is a Docker container with one volume, so nothing here is provider-specific. [HOSTING-ORACLE.md](docs/HOSTING-ORACLE.md) and [HOSTING-GCP.md](docs/HOSTING-GCP.md) document two free cloud VMs; the image is published for both `amd64` and `arm64`, so the target is one secret away.

```bash
docker compose up -d --build     # local
```

## Configuration

Two layers, deliberately separated:

- **`.env`** — process-level and secret: token, database path, webhook secret. Set once per deployment.
- **`/config`** — everything server-specific: channels, roles, language, game name, accent colour. Stored in SQLite, changed at runtime, different per server.

Adding the bot to a second server needs no redeploy and no environment change.

## License

MIT
