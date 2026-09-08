# Setup

From nothing to a bot answering commands in your server. About 20 minutes.

---

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**. Name it after the game.
2. **Bot** tab → **Reset Token** → copy it. This is your `DISCORD_TOKEN`.
   Treat it like a password: anyone with it controls the bot. It is shown once — if you lose it, reset it again.
3. Still on the **Bot** tab, under **Privileged Gateway Intents**, turn on:
   - ✅ **Server Members Intent** — required. Without it the bot never learns that someone joined, so the welcome card never fires.
   - ❌ Message Content Intent — leave **off**. The bot does not read message text, and skipping it avoids Discord's verification requirements later.
4. **General Information** tab → copy the **Application ID**. This is your `DISCORD_CLIENT_ID`.

## 2. Invite the bot to your server

Replace `YOUR_CLIENT_ID` and open the URL:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=361045945344
```

That permission number is the exact set the bot uses:

| Permission | Why |
|---|---|
| View Channels, Send Messages, Read Message History | Baseline |
| Embed Links, Attach Files | Announcements, devlogs, and the welcome card PNG |
| Mention Everyone | Only used when you pass `ping: true` to `/announce` |
| Manage Roles | The automatic role on join |
| Create Private Threads, Send Messages in Threads, Manage Threads | Bug reports |
| Manage Messages | Editing and pinning the bug panel |

**About Manage Roles:** Discord will not let a bot assign a role positioned above its own. In **Server Settings → Roles**, drag the bot's role above the role you want it to hand out.

## 3. Run it locally

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```ini
DISCORD_TOKEN=...            # from step 1
DISCORD_CLIENT_ID=...        # from step 1
DISCORD_DEV_GUILD_ID=...     # your test server's ID — see below
WEBHOOK_SECRET=...           # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

To get a server or channel ID: **User Settings → Advanced → Developer Mode**, then right-click the server or channel → **Copy Server ID** / **Copy Channel ID**.

> Setting `DISCORD_DEV_GUILD_ID` registers commands to that one server, where they appear **instantly**. Leaving it empty registers them globally, which is what you want in production but takes up to an hour to propagate. Use it while developing.

Then:

```bash
npm run commands:deploy   # publish the slash commands — run again whenever you add or change one
npm run dev               # start the bot with hot reload
```

You should see `connected to Discord` in the log.

## 4. Configure the server

In Discord, as someone with **Manage Server**:

```
/config channels welcome:#welcome announcements:#announcements devlogs:#devlog builds:#builds bugs:#bug-reports
/config roles join:@Member builds:@Build Notifications staff:@Team
/config general language:Español game_name:"Your Game" accent_color:#FF5C00
/config check
```

`/config check` walks every channel and role and reports what the bot can actually do. It is the first thing to run when something is not posting — a missing permission shows up as a red line instead of silence.

Then post the bug panel:

```
/bug panel
```

## 5. Test it

| What | How |
|---|---|
| Welcome card | `/welcome test` — renders it in the current channel without waiting for a real join |
| Announcement | `/announce` → fill the modal |
| Devlog | `/devlog` → fill the modal |
| Build | `/build announce version:0.1.0 channel:beta notes:First test` |
| Bug report | Click **Report a bug** on the panel |

To iterate on the welcome card design without Discord at all:

```bash
npm run preview:card -- "#FF5C00" "Your Game"
```

Writes sample cards to `preview/`. Drop artwork at `assets/welcome/background.png` (1000×350 or wider) and a `.ttf` in `assets/fonts/` to use the game's own typeface.

---

## Command reference

| Command | Who | What |
|---|---|---|
| `/config view` | Manage Server | Show current settings |
| `/config check` | Manage Server | Verify channels, roles and permissions |
| `/config channels` | Manage Server | Set where the bot posts |
| `/config roles` | Manage Server | Set the join / build-ping / staff roles |
| `/config general` | Manage Server | Language, game name, accent colour, welcome on/off |
| `/config reset` | Manage Server | Clear one setting |
| `/welcome test` | Manage Server | Preview the welcome card |
| `/announce` | Manage Messages | Post an announcement |
| `/devlog` | Manage Messages | Post a numbered devlog |
| `/build announce` | Manage Messages | Announce a build by hand |
| `/build latest` · `/build list` | Manage Messages | Build history |
| `/bug panel` | Staff | Post the "Report a bug" panel |
| `/bug list` · `/bug stats` | Staff | Open reports and counts |

Everything the bot replies to a command with is **ephemeral** — only the person who ran it sees the reply. The posts themselves go to the configured channels.

---

## Troubleshooting

**Commands do not appear.** Run `npm run commands:deploy`. If `DISCORD_DEV_GUILD_ID` is empty, global commands take up to an hour. Also make sure you invited the bot with the `applications.commands` scope (the URL above includes it).

**"This interaction failed".** The bot is not running, or it crashed handling the interaction. Check the logs.

**Welcome card never fires.** Almost always the **Server Members Intent** is off (step 1.3), or `/config general welcome_enabled:true` was never set. `/config check` will tell you about the channel; the intent you have to verify in the portal.

**The join role is not applied.** The bot's role must sit *above* the role it is assigning. `/config check` reports this explicitly.

**Bug reports fail to open.** The bug channel must be a normal text channel (not a forum or an announcement channel), and the bot needs Create Private Threads there.
