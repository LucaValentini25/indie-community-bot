# Plan

The base is built and runs. This is what exists, what is left to do to get it live, and what is worth adding next.

---

## Phase 0 — Foundation ✅ done

- Node 24 + TypeScript + discord.js v14 project, typechecked and linted
- SQLite via `node:sqlite` — no native compilation anywhere
- Migration runner, append-only schema
- Per-guild configuration in the database (multi-server from day one)
- en/es locales, type-checked against each other, switchable per server
- Filesystem-loaded commands and events
- Structured logging (pino), graceful shutdown, crash-safe interaction routing
- Dockerfile, compose files for local and production
- CI: typecheck, lint, format, build, container build, slash-command validation
- Deploy workflow: build → GHCR → SSH pull on the VM → health check

## Phase 1 — Features ✅ done

- **Welcome cards** — generated PNG, custom artwork and font support, accent colour, auto-role on join, `/welcome test` to preview
- **Announcements & devlogs** — modal-based, numbered devlogs, optional `@everyone`, audit trail
- **Builds** — `/build announce`, `/build latest`, `/build list`, plus `POST /hooks/build` for CI, with duplicate suppression
- **Bug reports** — panel → modal → private thread, claim / close-with-resolution / reopen, `/bug list`, `/bug stats`
- **`/config check`** — verifies every channel, role and permission

## Phase 2 — Go live ⬜ next

Roughly a day, most of it waiting on DNS and GCP.

1. **Create the Discord application** and invite the bot — [docs/SETUP.md](docs/SETUP.md) steps 1–2.
   Do not skip enabling the **Server Members Intent**.
2. **Run it locally** against a throwaway test server. Verify all five features.
3. **Design the welcome card.** `npm run preview:card`, drop artwork in `assets/welcome/`, iterate. This is the only piece that needs art direction.
4. **Push to GitHub** and confirm CI is green.
5. **Create the GCP VM** — [docs/HOSTING-GCP.md](docs/HOSTING-GCP.md). Set a $1 budget alert.
6. **Wire the deploy secrets**, push to `main`, watch it roll out.
7. **Register commands globally** (unset `DISCORD_DEV_GUILD_ID`) and configure the real server.
8. **Set up the backup cron.**

**Open decision — build notifications.** You said the pipeline is not set up yet, and Steam is the likely target. That is fine; nothing here blocks on it:

- The **manual** `/build announce` works today, no setup.
- The **zero-infra** path (`examples/github-actions/notify-discord-webhook.yml`) takes 5 minutes and no server changes.
- The **full** path needs a domain and TLS on the VM.

Recommendation: ship with manual, add the zero-infra webhook when the first CI pipeline exists, move to the full webhook once the bot has a domain. See [docs/BUILD-NOTIFICATIONS.md](docs/BUILD-NOTIFICATIONS.md).

---

## Phase 3 — Community features ⬜ candidates

Ordered by value-per-effort for a small indie community. None are started.

| Feature | Why | Effort |
|---|---|---|
| **Autoroles by button** | A panel of buttons for devlog pings, playtester, platform, language. Directly reduces ping fatigue, and the build-notification role already exists in config — this just lets people opt in themselves. | S |
| **Suggestions with voting** | `/suggestion` → posts with vote buttons and states (considering / accepted / rejected / shipped). The single most requested thing in game communities. | M |
| **Playtest signups** | A form + a capacity-limited list + a role handed out on acceptance. Pairs with Steam playtest branches. | M |
| **Bug report attachments & triage** | Priority and area labels, filter `/bug list` by them, and a nudge for reports with no screenshot. Grows naturally out of the tickets table. | S |
| **Moderation & logging** | Join/leave/delete logs, invite-link filter, automatic slowmode. Worth doing *before* the server gets big, not after. | M |
| **Scheduled devlogs** | Write it now, post it Friday. | S |
| **Steam/itch stats** | Wishlist counts, review snippets, a "now playing" presence. Read-only, low risk. | M |
| **FAQ / auto-responder** | Answers the same five questions forever. | S |

## Phase 4 — Reuse for a second game ⬜

Already designed for. Adding a second community is:

1. Invite the same bot to the new server.
2. Run `/config` there.
3. Point that game's CI at the same webhook with a different `guildId`.

No redeploy, no environment change, no fork. The things to revisit **only if** it grows past a handful of servers:

- Per-guild rate limiting on the webhook endpoint
- Moving from SQLite to Postgres (only if you ever need more than one replica)
- Sharding (Discord requires it past 2,500 servers — not a real concern here)

---

## Known limitations

Worth writing down so they are decisions, not surprises.

- **Single process, no clustering.** Intentional. Correct up to thousands of servers.
- **The card is rendered per join.** Fine at any realistic join rate; if a raid ever makes this hot, cache the background and queue the renders.
- **`/build list` shows the last 10.** No pagination yet.
- **Closing a ticket archives its thread.** Discord will hide it from the sidebar after a while; the data stays in the database.
- **The webhook has no rate limiting.** It is protected by a shared secret and should sit behind a reverse proxy. Add a limit if the endpoint is ever public-facing beyond CI.
- **No test suite yet.** CI covers typecheck, lint and command-definition validity. The highest-value tests to add first would be `announceBuild` duplicate handling and the i18n fallback chain.
