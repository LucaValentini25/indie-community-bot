# Build notifications

How "a new build shipped" turns into a message in Discord.

There are three ways to do it. They are not mutually exclusive — you can start with the manual one today and wire up CI later without changing anything.

| | Needs the bot online | Needs a public HTTPS endpoint | Recorded in `/build latest` | Effort |
|---|---|---|---|---|
| **A. Manual `/build announce`** | yes | no | yes | none |
| **B. CI → bot webhook** | yes | yes | yes | domain + TLS |
| **C. CI → Discord webhook** | no | no | **no** | 5 minutes |

**Recommendation:** start with **C** while you set the server up, and move to **B** once the bot has a domain. C is genuinely fine forever if you do not care about `/build list`.

---

## A. Manual

```
/build announce version:0.4.2 channel:beta platforms:Windows, Linux url:https://... notes:- Fixed the map crash\n- New tutorial
```

Use `\n` for line breaks — Discord's option box will not accept a real newline.

The bot posts the embed, pings the build role if one is configured, and records the build. Re-running the same version on the same channel is refused as a duplicate unless you pass `force:true`.

---

## B. CI → bot webhook

The richest option: the announcement carries the bot's identity, pings the role, and lands in the database, so `/build latest` and `/build list` work.

### 1. Set the secret

In the bot's `.env`:

```ini
WEBHOOK_SECRET=<64 hex chars>
```

Generate it with `openssl rand -hex 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

### 2. Expose the endpoint over HTTPS

See [HOSTING-ORACLE.md → Exposing the build webhook](./HOSTING-ORACLE.md#exposing-the-build-webhook-only-if-you-use-notify-botyml), or [HOSTING-GCP.md → Exposing the build webhook](./HOSTING-GCP.md#exposing-the-build-webhook-only-if-you-use-notify-botyml) if you host there. The container listens on `127.0.0.1:8080`; Caddy terminates TLS in front of it.

**The secret travels in a header, so plain HTTP would leak it.** Do not skip the TLS step.

### 3. Add the workflow to the *game* repo

Copy `examples/github-actions/notify-bot.yml` into your game repository as `.github/workflows/notify-build.yml`, and add these secrets there:

| Secret | Value |
|---|---|
| `BOT_WEBHOOK_URL` | `https://bot.yourdomain.com/hooks/build` |
| `BOT_WEBHOOK_SECRET` | The same value as `WEBHOOK_SECRET` |
| `DISCORD_GUILD_ID` | Your server ID |

### The API

```http
POST /hooks/build
X-Webhook-Secret: <the shared secret>
Content-Type: application/json
```

```jsonc
{
  "guildId":   "123456789012345678",  // required
  "version":   "0.4.2",               // required
  "channel":   "beta",                // default "stable"
  "platforms": "Windows, Linux",
  "notes":     "- Fixed the map crash\n- New tutorial",   // primary language
  "notesEn":   "- Fixed the map crash",                  // optional, per language
  "notesEs":   "- Arreglado el crash del mapa",          // optional, per language
  "url":       "https://store.steampowered.com/app/...",
  "source":    "github",              // shown in the embed footer
  "force":     false                  // re-announce a version already posted
}
```

`Authorization: Bearer <secret>` works too, if that fits your CI better.

**Bilingual servers.** Send `notesEn` and `notesEs` and the announcement gets one block per language, in the order the server publishes in. Each overrides `notes` for its own language; a language with no changelog simply gets no block, so a pipeline that only ever sends `notes` keeps working exactly as before.

| Status | Meaning |
|---|---|
| `200 {"status":"announced"}` | Posted |
| `200 {"status":"already_announced"}` | This version+channel was already posted. **Deliberately a success** — a re-run of a workflow should be a no-op, not a red build |
| `400` | Malformed JSON or payload; the response lists the failing fields |
| `401` | Wrong or missing secret |
| `404` | The bot is not in that guild |
| `409` | The build channel is unset, gone, or the bot cannot post in it |

Test it before touching CI:

```bash
curl -i -X POST https://bot.yourdomain.com/hooks/build \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{"guildId":"YOUR_GUILD_ID","version":"0.0.1-test","channel":"nightly","notes":"testing"}'
```

---

## C. CI → Discord webhook (no server needed)

Discord webhooks are URLs that accept a message. No bot, no port, no certificate.

1. In Discord: **Channel settings → Integrations → Webhooks → New Webhook**. Name it after the game, give it an avatar, **Copy Webhook URL**.
2. In the game repo, add `DISCORD_WEBHOOK_URL` as an Actions secret (and optionally `BUILD_ROLE_ID` to ping a role).
3. Copy `examples/github-actions/notify-discord-webhook.yml` into `.github/workflows/`.

**Treat the webhook URL as a secret.** Anyone holding it can post to that channel as the webhook.

The trade-off: the bot knows nothing about these builds, so `/build latest` and `/build list` will not show them.

---

## Steam

Steam does not emit an event when a build goes live — there is nothing to subscribe to. The announcement has to come from whatever pipeline uploaded the build.

`examples/github-actions/steam-deploy-and-notify.yml` is a full sketch: build → `steamcmd` upload via `game-ci/steam-deploy` → notify. The build step is engine-specific and marked as a placeholder.

The one genuinely fiddly part is **Steam Guard on a CI runner**. `steamcmd` cannot prompt for a code, so you capture a logged-in session once and hand it to CI:

1. Create a **separate builder account** and give it Steamworks access to the app. Do not use your personal account.
2. Log in once locally: `steamcmd +login builder_account` and complete 2FA.
3. Base64 the resulting `config.vdf`:
   - Linux/macOS: `base64 -w 0 ~/Steam/config/config.vdf`
   - Windows: `certutil -encode config.vdf out.txt` (then strip the header/footer lines)
4. Store it as the `STEAM_CONFIG_VDF` secret.

Steam invalidates this session periodically. When a deploy suddenly fails at login, redo steps 2–4 — it is expected maintenance, not a broken pipeline.

A pattern worth adopting: have CI upload to a `beta` branch and announce with `channel:beta`, then set it live on `default` manually in Steamworks. The Discord notification then tells your playtesters exactly what to opt into.

---

## itch.io

If you also publish there, `butler` slots into the same workflow:

```yaml
- name: Push to itch.io
  env:
    BUTLER_API_KEY: ${{ secrets.BUTLER_API_KEY }}
  run: |
    curl -L -o butler.zip https://broth.itch.zone/butler/linux-amd64/LATEST/archive/default
    unzip butler.zip && chmod +x butler
    ./butler push build/StandaloneWindows64 user/game:windows --userversion "$VERSION"
```

Then reuse the same `announce` job. `butler` uses an API key, so there is no Steam Guard dance.
