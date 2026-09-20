# Hosting on Cloudflare Workers — no server, no cost

This is the variant of the bot for when you **do not have a server**. It runs on
Cloudflare's free plan, answers slash commands, buttons and modals over
Discord's HTTP interactions endpoint, and stores its data in Cloudflare D1
(SQLite). Nothing stays running; Cloudflare wakes the Worker for each request.

```
Discord ──POST /interactions──►  Cloudflare Worker  ──►  D1 (SQLite)
   ▲                                   │
   └───────── REST calls (post, threads, roles) ◄┘
```

If you later get a server, you can switch to the always-on bot without losing
anything but the data in D1 — see [Moving to a server later](#moving-to-a-server-later).

---

## What works, and what does not

| | Serverless (this page) | Always-on ([DEPLOYMENT.md](DEPLOYMENT.md)) |
|---|:---:|:---:|
| `/announce`, `/devlog` | ✅ | ✅ |
| `/build` and the CI webhook (`POST /hooks/build`) | ✅ | ✅ |
| `/bug` panel, tickets, claim / close / reopen | ✅ | ✅ |
| `/selfrole` panel | ✅ | ✅ |
| `/config`, `/access`, bilingual posts | ✅ | ✅ |
| **Welcome card when someone joins** | ❌ | ✅ |
| **Auto-role when someone joins** | ❌ | ✅ |
| Cleaning up settings when a role is deleted | ❌ | ✅ |

The three ❌ share one cause: Discord only announces "a member joined" or "a
role was deleted" over the **gateway**, a WebSocket that has to stay open. A
Worker cannot hold one.

What Discord offers natively for the join features, no server needed:

- **Welcome message:** *Server Settings → Community → Welcome Screen* (for
  Community servers), and the *Send a welcome message* toggle under *Overview →
  System Messages*. There is no custom image card without the always-on bot.
- **Roles on join:** there is no built-in "give everyone this role" setting.
  *Onboarding* can assign roles from the answers a new member picks, and the
  bot's `/selfrole` panel lets them pick roles themselves. Giving every member
  a role automatically needs the always-on bot.

A deleted role is handled lazily instead: the settings that pointed at it fail
with a clear message the next time they are used, and `/config check` shows it.

---

## Cost: how to be sure you are never charged

Cloudflare does not bill the free plan. It **stops serving** when you hit a
limit, so the worst case is the bot refusing commands until the next day.

- Do **not** add a payment method.
- Do **not** subscribe to *Workers Paid*, the paid plan. Everything below runs on *Workers Free*.
- Check *Workers & Pages → Plans* in the dashboard: it should say **Free**.

The free limits, and how far a community bot is from them:

| Limit (free plan) | Value | This bot |
|---|---|---|
| Requests | 100,000 / day | A busy server is hundreds a day |
| CPU time per request | 10 ms | A few ms; Discord's network waiting does not count |
| Bundle size | 3 MB compressed | **≈ 230 KB** |
| D1 storage | 5 GB | Megabytes |
| D1 reads / writes | 5,000,000 / 100,000 per day | Tens of thousands at most |

Limits change; the current ones are at <https://developers.cloudflare.com/workers/platform/limits/>
and <https://developers.cloudflare.com/d1/platform/limits/>.

---

## Setup

You need Node 24 and a free Cloudflare account. All commands run from the repo
root.

### 1. Create the Discord application

If you already followed [SETUP.md](SETUP.md), reuse that application. The
differences for serverless:

- You do **not** need the *Server Members Intent* (that is a gateway thing).
- From *General Information*, copy the **Application ID** and the **Public Key**.
- From *Bot*, copy the **Token**.

> **Use a separate application from your development one.** Once an
> application has an Interactions Endpoint URL, Discord sends its interactions
> *there* and never to a bot connected over the gateway. See
> [the two applications](DEPLOYMENT.md#the-part-that-catches-everybody-you-need-two-discord-applications).

### 2. Log in and create the database

```bash
npx wrangler login
npx wrangler d1 create indie-community-bot
```

The second command prints a `database_id`. Paste it into
[`worker/wrangler.toml`](../worker/wrangler.toml), replacing the
`00000000-…` placeholder.

### 3. Create the tables

```bash
npm run worker:migrate
```

This applies `worker/migrations/*.sql` to the remote database. They are
generated from `src/db/migrations.ts`, the same list the always-on bot runs, so
both always have the same schema. After changing that file, regenerate them
with `npm run worker:migrations`.

### 4. Set the secrets

```bash
npx wrangler secret put DISCORD_TOKEN        -c worker/wrangler.toml
npx wrangler secret put DISCORD_PUBLIC_KEY   -c worker/wrangler.toml
npx wrangler secret put WEBHOOK_SECRET       -c worker/wrangler.toml   # only if CI will announce builds
```

Each prompts for the value. `WEBHOOK_SECRET` is any random string of 16+
characters; `openssl rand -hex 24` makes one.

### 5. Deploy

```bash
npm run worker:deploy
```

It prints your URL, like `https://indie-community-bot.<you>.workers.dev`.
Opening it in a browser should show `{"status":"ok","mode":"serverless"}`. If it
says `misconfigured`, a secret from step 4 is missing.

### 6. Tell Discord where to send interactions

*Developer Portal → your application → General Information → **Interactions
Endpoint URL***, set it to:

```
https://indie-community-bot.<you>.workers.dev/interactions
```

Discord tests it immediately (a signed ping and an unsigned one that must be
rejected). If saving fails, run `npx wrangler tail -c worker/wrangler.toml` and
try again — the log says why.

### 7. Register the commands and invite the bot

Commands are registered from your machine, exactly as for the always-on bot.
Your everyday `.env` holds the **development** application, so production gets
its own file. Create `.env.prod` (git ignores it) with the production
`DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, leave `DISCORD_DEV_GUILD_ID` empty so
they register globally, and run:

```bash
npm run commands:deploy:prod
```

Global commands take up to an hour to appear. Then invite the bot with the same URL as the always-on version — the
permissions are identical, and the table explaining each one is in
[SETUP.md](SETUP.md#2-invite-the-bot-to-your-server):

```
https://discord.com/api/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=361045945344
```

Then, in your server, run `/config channels` and `/config check` as described
in [SETUP.md](SETUP.md#4-configure-the-server).

---

## Announcing builds from CI

The webhook is the same as the always-on bot's, so
[`examples/github-actions/notify-bot.yml`](../examples/github-actions/notify-bot.yml)
works unchanged. Only the URL differs:

```
POST https://indie-community-bot.<you>.workers.dev/hooks/build
X-Webhook-Secret: <your WEBHOOK_SECRET>
```

See [BUILD-NOTIFICATIONS.md](BUILD-NOTIFICATIONS.md) for the payload.

---

## Developing and debugging

```bash
npm run worker:test          # 28 end-to-end checks; no Cloudflare or Discord needed
npm run worker:typecheck
npx wrangler tail -c worker/wrangler.toml     # live logs from the deployed Worker
```

`worker:test` runs the real Worker code against a fake D1 and a fake Discord,
with real Ed25519 signatures. Run it before deploying.

To run the Worker locally under the same runtime Cloudflare uses:

1. Copy `worker/.dev.vars.example` to `worker/.dev.vars` and fill it in.
2. `npm run worker:migrate:local`
3. `npm run worker:dev`

Discord cannot reach `localhost`, so to receive real interactions while
developing, tunnel it (`cloudflared tunnel --url http://localhost:8787`) and put
the tunnel URL in the Developer Portal of your **development** application.

### Deploying from GitHub instead of your machine

`.github/workflows/deploy-worker.yml` deploys on demand (*Actions → Deploy
Worker → Run workflow*). It needs two repository secrets:
`CLOUDFLARE_API_TOKEN` (a token created from the *Edit Cloudflare Workers*
template) and `CLOUDFLARE_ACCOUNT_ID`.

---

## When something goes wrong

Every one of these was hit for real while setting this up. Live logs are the
fastest way to see what the Worker is actually receiving:
`npx wrangler tail indie-community-bot -c worker/wrangler.toml`.

| Symptom | Cause | Fix |
|---|---|---|
| Discord: *"could not verify the interactions endpoint URL"* | The `DISCORD_PUBLIC_KEY` secret is wrong. By far the usual mistake is pasting the **Application ID** (a 17–19 digit number) instead of the **Public Key** (64 characters, `0-9a-f`). The log shows the Worker rejecting Discord's signed ping with a 401 and a `rejected an interaction signature` line naming the key's length. | Set it again: `npx wrangler secret put DISCORD_PUBLIC_KEY -c worker/wrangler.toml`. Secrets apply instantly, no redeploy. |
| `/health` says `misconfigured` | A secret is missing **or empty**. | Set it again. See the next row for why it can end up empty. |
| A secret was "uploaded" but the Worker still says it is missing | `wrangler secret put` reads the value from your keyboard. Run through a tool that gives it no terminal (an editor's run button, a CI step, an AI agent's shell), it succeeds with an **empty** value. | Run it yourself in a normal terminal, and check that it prints `Enter a secret value:`. |
| Commands appear, but the bot answers *"I am not a member of this server"* (or every command fails) | The app was installed with only the `applications.commands` scope. `/` works, but the bot is not in the server, so it cannot read or post anything. | Re-invite with the URL from [SETUP.md](SETUP.md#2-invite-the-bot-to-your-server), which includes `scope=bot`. Confirm the bot shows in the member list. |
| `/config check` looks fine but posting fails | With no channels configured `/config check` makes no API calls, so it cannot fail. | Set channels with `/config channels`, then run `/config check` again. |
| Commands do not appear in Discord | Global commands take up to an hour. | Wait; or register to one server with `DISCORD_DEV_GUILD_ID` set, which is instant. |
| A secret in the dashboard is named like your token | `wrangler secret put <NAME>` takes the *name*, not the value. Passing the token as the name creates a secret called after it, visible in the dashboard. | `npx wrangler secret delete <that name>`, and reset the token in the Developer Portal. |
| Deploy fails on the database | `database_id` in `worker/wrangler.toml` is still the placeholder. | Paste the id printed by `wrangler d1 create`. |
| First request to a new `workers.dev` address fails with an SSL error | The subdomain is still propagating. | Wait a few minutes. |

**Do not paste tokens into chats, tickets or commands' arguments.** If one
leaks, reset it in the Developer Portal (*Bot → Reset Token*) and set the new
one with `wrangler secret put DISCORD_TOKEN`.

---

## How it differs from the always-on bot

The commands' *definitions* (names, options, translations) are shared: there is
one `src/commands/`, and `commands:deploy` registers it for both variants. What
is reimplemented is the *handling*, in `worker/src/`:

| | Always-on (`src/`) | Worker (`worker/src/`) |
|---|---|---|
| Discord library | discord.js | plain `fetch` + `@discordjs/builders` |
| Receives interactions | gateway WebSocket | HTTP POST, signature-checked |
| Database | `node:sqlite`, synchronous | D1, asynchronous |
| First reply | an API call | the HTTP response itself |
| Per-guild cache | in memory, safe (one writer) | none across requests (many isolates) |

Shared verbatim: the i18n strings, the text helpers, the settings model
(`src/config/guild-model.ts`) and the database schema.

Two things worth knowing if you read the code:

- **The 3-second rule is stricter here.** A handler that will call Discord's
  API answers with `deferReply()` first, then finishes in the background with
  `editReply()`. Cloudflare keeps the request alive for that (`waitUntil`).
- **Bot permissions are computed, not read.** A gateway bot has every channel
  cached; a Worker does not, so `worker/src/discord/permissions.ts` works out
  what the bot may do in a channel from its roles and the channel's overwrites.

---

## Moving to a server later

1. Deploy the always-on bot ([DEPLOYMENT.md](DEPLOYMENT.md)) with a **new** database.
2. Clear the *Interactions Endpoint URL* in the Developer Portal — otherwise
   Discord keeps sending interactions to the Worker instead of the gateway.
3. To carry your settings over: `npx wrangler d1 export indie-community-bot --remote --output backup.sql`,
   then load the `guild_config`, `command_access` and `self_roles` tables into
   `data/bot.db` with the `sqlite3` CLI. Announcement, build and ticket history
   can move the same way; the schema is identical.

Nothing in the Discord application changes: same token, same commands, same
invite.
