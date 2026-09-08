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
| 🌍 **English + Spanish** | Set per server with `/config general language:`. Locales are type-checked against each other, so a missing translation is a compile error. |
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
/config general language:Español game_name:"Your Game" accent_color:#FF5C00
/config check
/bug panel
```

`/config check` verifies every channel, role and permission and tells you exactly what is missing. Run it first whenever something is not posting.

## Preview the welcome card without Discord

```bash
npm run preview:card -- "#FF5C00" "Your Game"
```

Writes samples to `preview/`. Drop artwork at `assets/welcome/background.png` (1000×350 or wider) and a `.ttf` in `assets/fonts/` for the game's own typeface — no code changes.

## Documentation

| | |
|---|---|
| **[SETUP.md](docs/SETUP.md)** | Discord app, intents, invite, first run, command reference, troubleshooting |
| **[HOSTING-GCP.md](docs/HOSTING-GCP.md)** | Free 24/7 hosting on a Google Cloud e2-micro, with automatic deploys, TLS, and backups |
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

The bot holds an open WebSocket to Discord, so it needs a process that stays alive — **Vercel and Cloudflare Workers cannot host it** (they can serve slash commands over HTTP Interactions, but never `guildMemberAdd`, which is what the welcome card runs on).

The setup documented here is a **Google Cloud `e2-micro`**, which is free indefinitely on the Always Free tier and runs this comfortably. GitHub Actions builds the image and the VM only pulls it, because 1 GB of RAM is enough to run the bot but not to compile it.

Nothing is Google-specific: it is a Docker container with one volume. Oracle Cloud's free ARM instance, a €4 VPS, or a Raspberry Pi all work with the same two files.

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
