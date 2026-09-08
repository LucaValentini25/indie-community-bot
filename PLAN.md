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
- **Self-assignable roles** — `/selfrole` builds a button panel members use to opt into roles themselves; toggles on click, bilingual labels, and every hierarchy/permission problem is reported when the role is added rather than discovered at click time
- **Role-based command access** — `/access` narrows any command, or the whole bot, to the roles you name. Enforced once in the interaction router; administrators and the owner always pass; deleting a role deletes its rules
- **Bilingual publishing** — a second public language per server: announcements, devlogs, the bug panel and the welcome message render in both, one embed per language in a single message. Ephemeral replies follow each viewer's own Discord language, and a bug thread follows the reporter's

## Phase 2 — Go live ⬜ next

Steps 1–4 need nothing but a laptop. Step 5 onward needs the machine that will host it.

1. **Create the Discord application** and invite the bot — [docs/SETUP.md](docs/SETUP.md) steps 1–2.
   Do not skip enabling the **Server Members Intent**.
2. **Run it locally** against a throwaway test server. Verify every feature.
3. **Design the welcome card.** `npm run preview:card`, drop artwork in `assets/welcome/`, iterate. This is the only piece that needs art direction.
4. **Push to GitHub** and confirm CI is green.
5. **Set up the machine.** The bot measures ~125 MB resident, so a spare mini PC or a Raspberry Pi qualifies. It only makes *outbound* connections to Discord, so it needs no static IP, no port forwarding and no domain. For a cloud VM instead, see [docs/HOSTING-ORACLE.md](docs/HOSTING-ORACLE.md) or [docs/HOSTING-GCP.md](docs/HOSTING-GCP.md).
6. **Wire up deploys** — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Two Discord applications: the dev one runs locally, the production one on the server behind a systemd timer that polls GHCR. After that, `git push` to `main` is the deploy.
7. **Register commands globally** (unset `DISCORD_DEV_GUILD_ID`) and configure the real server.
8. **Set up the backup cron.**

**Open decision — build notifications.** Nothing here blocks on having a CI pipeline yet. Three paths, in increasing order of setup:

- The **manual** `/build announce` works today, no setup.
- The **zero-infra** path (`examples/github-actions/notify-discord-webhook.yml`) takes 5 minutes and no server changes.
- The **full** path needs a domain and TLS on the VM.

The intended order is to ship with manual, add the zero-infra webhook once a CI pipeline exists, and move to the full webhook when the bot has a domain. See [docs/BUILD-NOTIFICATIONS.md](docs/BUILD-NOTIFICATIONS.md).

---

## Phase 3 — Community features ⬜ candidates

Ordered by value-per-effort for a small indie community. None are started.

| Feature | Why | Effort |
|---|---|---|
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
