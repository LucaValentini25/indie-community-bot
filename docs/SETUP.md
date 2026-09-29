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
| Manage Roles | The automatic role on join, and the `/selfrole` panel |
| Create Private Threads, Send Messages in Threads, Manage Threads | Bug reports |
| Manage Messages | Editing and pinning the bug panel |

**About Manage Roles:** Discord will not let a bot assign a role positioned above its own. In **Server Settings → Roles**, drag the bot's role above every role you want it to hand out — the join role and anything on the `/selfrole` panel. `/selfrole list` flags any role that fails this.

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
/config general language:Español second_language:English game_name:"Your Game" accent_color:#FF5C00
/config check
```

### Running a bilingual server

`second_language` is what makes the server bilingual. With it set, **everything the whole server sees is published in both languages**: announcements and devlogs get one embed per language in a single message, the bug panel shows both, and the welcome message greets in both. The primary `language` always comes first.

Two things happen automatically and need no configuration:

- **Replies only you see are in *your* language.** Discord tells the bot which language each person has their client set to, so `/config check`, confirmations and errors come back in Spanish for a Spanish client and English for an English one, regardless of the server setting.
- **A bug thread speaks the reporter's language.** The report form, the embed and its buttons render in whatever language the person who opened it uses.

To post in one language only, pass `language:` to `/announce` or `/devlog`. To go back to monolingual: `/config reset setting:Second language`.

#### One channel per language

By default both languages share a channel. If the server runs them side by side instead — `#anuncios` next to `#announcements` — give the second language its own channel:

```
/config channels announcements_secondary:#announcements devlogs_secondary:#devlogs-en builds_secondary:#builds-en welcome_secondary:#welcome-en
```

Each option is independent, so you can split announcements and keep builds shared. With a channel set, each language goes out as its own message in its own channel, and the welcome card is drawn once per language. Bug threads are the exception: a thread already speaks the reporter's language and has to live in one channel.

Publishing is **all or nothing**. Both channels are checked before anything is sent, so a devlog never goes out in one language only — if the second channel is unusable, neither message is posted and `/config check` shows which channel is at fault. To go back to sharing: `/config reset setting:Announcements channel (2nd language)` (and likewise for the others).

`/config check` walks every channel and role and reports what the bot can actually do. It is the first thing to run when something is not posting — a missing permission shows up as a red line instead of silence.

Then post the bug panel:

```
/bug panel
```

### Artwork for the welcome card

`assets/welcome/background.png` is the default every server falls back to. To give one server its own:

```
/welcome background url:https://raw.githubusercontent.com/you/game/main/art/banner.png
/welcome background file:[upload an image]
/welcome background clear:true
/welcome test
```

The card is 1000×350, so supply that or wider; anything smaller is stretched.

**Only the link is stored in the database, never the image.** The bytes are cached next to the database on the data volume. That matters for two reasons:

- **Discord attachment links expire.** Since 2023 they are signed and stop resolving after about a day, so a URL copied out of a Discord message would work when you set it and quietly stop the next morning. Caching at set time makes the upload path safe anyway — but for a link you paste, prefer a stable host over a Discord CDN URL.
- **A join never waits on the network.** The card renders from a local file.

The link is validated when you set it, not when somebody joins: it must be reachable, be served as an image, decode as one, and stay under 8 MB. You get the specific reason immediately rather than discovering a blank card the next time a member arrives.

The **font** is still global — it is registered once at startup from `assets/fonts/`, so it is shared by every server this bot serves.

### The bot's own look, per server

The bot has **two separate appearances**, and confusing them is the usual mistake:

| | Where it lives | Scope |
|---|---|---|
| **Global identity** | Developer Portal, or `client.user.setAvatar()` | One picture for the whole application — DMs, the profile card, every server |
| **Server profile** | `/config branding` | Independent in each server |

`/config branding` sets the second one:

```
/config branding avatar:[attach a square PNG] nickname:Nombre del Juego
/config branding banner:[attach an image]
/config reset setting:Server avatar
```

**Never try to do this by changing the global avatar per server.** Discord rate limits application avatar and username changes to roughly a couple per hour, so two communities would overwrite each other and both would end up throttled and out of sync. The per-guild profile has no such conflict — it is a different picture in every server, all at once.

Nothing is stored on our side. Discord keeps the server profile, so this writes no database row and nothing is re-applied at startup; `/config view` reads the current state straight off the bot's own member. Changing the nickname needs the **Change Nickname** permission. Avatars want a square PNG or JPG under 10 MB — animated ones are often refused, and the error says so rather than failing quietly.

### Roles that members give themselves

`/config roles` sets the roles the *bot* uses. `/selfrole` sets the ones **members** hand themselves, from a panel of buttons:

```
/selfrole add role:@Build alerts label:Avisos de build label_en:"Build alerts" emoji:🚀
/selfrole add role:@Playtester   label:Playtester
/selfrole panel channel:#roles
```

Clicking a button gives the role; clicking it again takes it away. The reply is ephemeral and in the clicker's own language.

The natural pairing is with the build-ping role: set it once with `/config roles builds:@Build alerts`, then put that same role on the panel. From then on people opt into build notifications themselves instead of asking a moderator, and `/build announce` keeps pinging exactly the people who asked for it.

A few practical notes:

- **The bot's own role must sit above every role on the panel**, and it needs Manage Roles. `/selfrole add` refuses a role it could not assign and tells you why, rather than letting you build a panel that silently does nothing. `/selfrole list` re-checks all of them — run it first when a button stops working.
- **A panel holds 25 roles**, which is Discord's limit of five buttons across five rows.
- **Buttons carry one label for everyone.** In a bilingual server `label_en` and `label_es` are joined onto it (`Avisos de build · Build alerts`), while the embed above renders fully in each language. Pass only `label` and both languages show the same text.
- **Already-posted panels keep their old buttons.** After adding or removing a role, run `/selfrole panel` again to post an updated one. Clicking a stale button is handled — it tells the person the panel is out of date instead of failing.
- Deleting a role in Discord takes it off the panel automatically.

### Limiting who can use the bot

By default each command is gated by a Discord permission — `/announce` needs Manage Messages, `/config` needs Manage Server. That is coarse: Manage Messages is one checkbox shared with a dozen unrelated abilities, so a moderator who should only be deleting spam can also publish to the whole community.

`/access` narrows it to named roles:

```
/access allow command:everything role:@Team          # nobody outside @Team gets any command
/access allow command:/build role:@Release           # …except /build, which only @Release may run
/access show                                         # who may use what, in one embed
/access clear command:/build                         # back to the @Team rule
```

Three things worth knowing:

- **A command's own list replaces the `everything` list, it does not add to it.** That is what makes the two lines above mean "the team runs the bot, but only the release crew ships a build". If @Team should keep `/build` too, allow them there as well.
- **Administrators and the server owner always pass**, so a rule can never lock you out of your own server. `/access` itself is Administrator-only and cannot be restricted.
- **These rules only narrow, never widen.** Discord hides a command outright from anyone lacking its base permission, and the bot never sees the interaction. To *open* a command to a role that lacks that permission, do it in **Server Settings → Integrations → {bot}**, then narrow it back here.

Deleting a role also deletes its rules, so a command never ends up locked behind a role nobody can hold.

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
| `/config branding` | Manage Server | The bot's own avatar, banner and nickname in this server |
| `/config reset` | Manage Server | Clear one setting |
| `/access show` | Administrator | Show which roles may use which command |
| `/access allow` · `/access revoke` | Administrator | Limit a command to specific roles |
| `/access clear` | Administrator | Drop every rule for a command |
| `/selfrole add` · `/selfrole remove` | Manage Server | Choose which roles members may give themselves |
| `/selfrole list` | Manage Server | The panel's roles, and whether the bot can assign each |
| `/selfrole panel` | Manage Server | Post the button panel |
| `/welcome test` | Manage Server | Preview the welcome card |
| `/welcome background` | Manage Server | Set this server's card artwork, by link or upload |
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
