# Architecture

Why the code is shaped the way it is. Read this before making a structural change.

---

## The one constraint that drives everything

A Discord bot that reacts to **events** — someone joined, someone clicked a button — has to hold an open WebSocket to Discord's gateway. That rules out serverless hosting (Vercel, Cloudflare Workers, Lambda): those wake on a request, run briefly, and die.

Slash commands alone *could* run serverless, through Discord's HTTP Interactions endpoint. But the welcome card fires on `guildMemberAdd`, which only arrives over the gateway. So: **one long-running process**. Every hosting decision follows from that.

---

## Layout

```
src/
├─ index.ts              Boot: migrate → load → connect → serve → shut down cleanly
├─ config/
│  ├─ env.ts             Process config from the environment, validated once at boot
│  ├─ guild.ts           Per-guild settings, cached, backed by SQLite
│  └─ access.ts          Which roles may run which command, cached the same way
├─ core/
│  ├─ client.ts          discord.js client: intents and cache limits
│  ├─ loader.ts          Filesystem discovery of commands and events
│  ├─ logger.ts          pino: JSON in production, pretty in dev
│  └─ types.ts           Command and EventHandler contracts
├─ db/
│  ├─ index.ts           Connection, pragmas, migration runner, typed query helpers
│  └─ migrations.ts      Ordered, append-only schema history
├─ i18n/                 en/es strings, type-checked against each other
├─ features/             The actual behaviour, independent of how it was triggered
│  ├─ welcome/           Card rendering (canvas) + join handling
│  ├─ announcements/     Announcements and devlogs
│  ├─ builds/            Build announcements + history
│  ├─ tickets/           Bug reports: panel, modal, threads, lifecycle
│  └─ selfroles/         Opt-in role panel: buttons, toggling, assignability
├─ commands/             Slash command definitions — thin, delegate to features
├─ events/               Gateway event handlers — thin, delegate to features
├─ http/server.ts        /health and POST /hooks/build
├─ lib/                  Small shared helpers (text, interaction context)
└─ scripts/              CLI entry points: deploy-commands, backup, preview-card
```

The rule: **`commands/` and `events/` contain no logic.** They parse input and call into `features/`. That is what lets `/build announce` and `POST /hooks/build` produce a byte-identical announcement — both call `announceBuild()`, and there is no second code path to drift.

---

## Decisions

### TypeScript + discord.js

discord.js is the largest, best-documented Discord library, and it ships its own types. With a bot that will keep growing, the compiler catching a renamed config field beats finding it in production.

### SQLite via `node:sqlite`, not better-sqlite3

Node 24 ships SQLite in core. That means **no native compilation**: the same code runs on a Windows dev machine and in a slim Linux container with no build toolchain, no `node-gyp`, and no prebuilt-binary roulette on ARM.

SQLite over Postgres because this is one process with a low write volume. A file on a persistent disk is far less to operate, and a backup is one command. If the bot ever needs to run as multiple replicas, that is the moment to reconsider — not before.

Rows come back as `Record<string, SQLOutputValue>`, so reading one into a domain type needs a cast. `queryOne` / `queryAll` / `queryOneRequired` in `db/index.ts` are the **only** place that cast is allowed to live.

### Migrations as an ordered array

`db/migrations.ts` is append-only. Never edit or reorder a shipped migration; add a new one. Each runs once, inside a transaction, and a failure rolls back and stops the boot rather than leaving a half-migrated database.

### Per-guild config in the database, not in env

Nothing about a specific game or server is hardcoded. A second community means one more row, created automatically on `guildCreate`. This is what "I might reuse it later" costs upfront, and it is cheap: one table and a cache.

The cache is safe because this process is the only writer. It is invalidated on every write.

### Filesystem loading of commands and events

Adding a command is dropping a file in `src/commands/<group>/` with a default export. There is no registry to remember to update, which is the failure mode a registry always eventually has.

Cost: a bad default export is a runtime warning rather than a compile error. `scripts/validate-commands.mjs` runs in CI to catch malformed definitions before Discord's API rejects them with an opaque 400.

### Custom IDs carry the id, nothing else

Component custom IDs follow `feature:action:id`. The handler re-reads the ticket from the database rather than trusting anything embedded in the button — a custom ID is client-supplied data.

### Intents: the minimum

`Guilds` + `GuildMembers`. `GuildMembers` is privileged and required for the welcome card. **`MessageContent` is deliberately not requested** — nothing reads message text, and skipping it avoids a second privileged intent and the verification Discord requires past 100 servers.

### `allowedMentions` on every send

Every outbound message sets it explicitly. Without it, an `@everyone` typed into a changelog or a bug report would actually fire. Pings are opt-in and never come from user-supplied text.

### Errors never leave an interaction hanging

`events/interactionCreate.ts` wraps every handler. Handlers may throw freely; the router logs with full context and shows one generic localized message. The alternative is Discord's "application did not respond", which tells the user nothing and you less.

### Authorisation is enforced in one place

`setDefaultMemberPermissions` on a command is Discord's gate, and it is coarse: Manage Messages is a single checkbox shared with a dozen unrelated abilities. `config/access.ts` adds a per-guild role list on top, and `events/interactionCreate.ts` is the **only** place it is checked — before `execute()` and before any autocomplete handler runs. A command file therefore cannot forget the check, and adding a command does not mean remembering to add a guard.

It can only narrow. Discord never delivers the interaction to a member who fails the base permission, so the bot has no way to widen access from here — that stays in Server Settings → Integrations, deliberately. Administrators and the owner always pass, because a rule that can lock the server out of its own bot is a bug waiting to happen. A command's own role list overrides the wildcard rather than merging with it, which is what makes "staff run the bot, only the release crew ships a build" expressible.

### Three different questions about language

They are genuinely separate, and conflating them is what makes bilingual bots feel broken:

1. **What does the server publish in?** `config.locale` plus the optional `config.secondaryLocale`. `localeRenderers()` turns that into an ordered list, and every public-content builder maps over it — a monolingual server is the one-element case, so there is no "is it bilingual" branch anywhere.
2. **What does *this viewer* read?** Discord sends `interaction.locale`. `contextForUser()` honours it for ephemeral replies, falling back to the server's primary for a language we do not speak. Zero configuration, and the right answer in a mixed community.
3. **What language is *this record* in?** A bug report stores the locale it was filed in, so its thread keeps speaking the reporter's language no matter who clicks the buttons later. A build stores its changelog per language in `notes_i18n`.

A public post never uses the viewer's language; an ephemeral reply never uses the server's. `contextFor` vs `contextForUser` at the call site is the whole distinction.

### i18n as TypeScript, not JSON

`locales/es.ts` is typed against `locales/en.ts`. Adding an English key without translating it is a **compile error**, not an `undefined` in production. `t()` still falls back to English at runtime, then to the key itself — a visibly wrong string beats a crash mid-interaction.

---

## Request flow

**Slash command**

```
Discord → interactionCreate → router → commands/<name>.execute()
                                          → features/<feature>
                                          → db + Discord API
```

**Bug report**

```
Button "Report a bug"  → showReportModal()
Modal submit           → handleReportSubmit()
                           → nextTicketNumber()      atomic, per guild
                           → create private thread
                           → createTicket()          persist
                           → post embed + buttons
Claim / Close / Reopen → repository update → edit embed in place
```

**Build from CI**

```
GitHub Actions → POST /hooks/build
                   → constant-time secret check
                   → zod validation
                   → announceBuild()      ← same function /build announce calls
                        → duplicate check
                        → post embed, ping role
                        → record in builds
```

---

## Adding a feature

1. Put the behaviour in `src/features/<name>/`. It should be callable from anywhere, not just from a command.
2. Add strings to `i18n/locales/en.ts`, then `es.ts` — the compiler will insist.
3. Add a thin `src/commands/<group>/<name>.ts` that parses options and calls into the feature.
4. If it needs storage, append a migration. Never edit an existing one.
5. `npm run typecheck && npm run lint && npm run build`, then `npm run commands:deploy`.

## Gotchas worth knowing

- **The 3-second rule.** Discord kills an interaction that is not acknowledged within 3 seconds. Anything slower — rendering a card, creating a thread, an HTTP fetch — must `deferReply()` first. After deferring you have 15 minutes.
- **`showModal` cannot be deferred.** It must be the first response to the interaction.
- **Role hierarchy.** A bot cannot assign a role above its own, no matter its permissions. `/config check` reports this because it is the single most common "why isn't it working".
- **Private threads need a plain text channel.** Not a forum, not an announcement channel.
- **Ephemeral replies** use `flags: MessageFlags.Ephemeral`. The old `ephemeral: true` is deprecated.
