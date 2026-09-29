/**
 * Ordered, append-only list of schema migrations.
 *
 * Rules:
 *  - Never edit or reorder a migration that has already shipped; add a new one.
 *  - Each entry runs exactly once per database, inside a transaction.
 *  - Keep them pure SQL so the schema history stays readable.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: /* sql */ `
      -- One row per Discord server. Everything the bot needs to behave
      -- differently per community lives here, so the same deployment can serve
      -- several games at once.
      CREATE TABLE guild_config (
        guild_id                TEXT PRIMARY KEY,
        locale                  TEXT NOT NULL DEFAULT 'en',

        -- Welcome
        welcome_enabled         INTEGER NOT NULL DEFAULT 0,
        welcome_channel_id      TEXT,
        welcome_role_id         TEXT,

        -- Content
        announce_channel_id     TEXT,
        devlog_channel_id       TEXT,

        -- Builds
        build_channel_id        TEXT,
        build_role_id           TEXT,

        -- Tickets
        ticket_channel_id       TEXT,
        ticket_staff_role_id    TEXT,
        ticket_counter          INTEGER NOT NULL DEFAULT 0,

        -- Branding
        accent_color            TEXT NOT NULL DEFAULT '#5865F2',
        game_name               TEXT,

        created_at              INTEGER NOT NULL,
        updated_at              INTEGER NOT NULL
      ) STRICT;

      -- Bug reports / support tickets. Each one is backed by a private thread.
      CREATE TABLE tickets (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id           TEXT NOT NULL,
        number             INTEGER NOT NULL,
        thread_id          TEXT NOT NULL UNIQUE,
        opener_id          TEXT NOT NULL,
        category           TEXT NOT NULL,
        title              TEXT NOT NULL,
        body               TEXT NOT NULL,
        platform           TEXT,
        build_version      TEXT,
        status             TEXT NOT NULL DEFAULT 'open',
        resolution         TEXT,
        closed_by          TEXT,
        created_at         INTEGER NOT NULL,
        closed_at          INTEGER,
        UNIQUE (guild_id, number)
      ) STRICT;

      CREATE INDEX idx_tickets_guild_status ON tickets (guild_id, status);
      CREATE INDEX idx_tickets_opener ON tickets (guild_id, opener_id);

      -- Every build announcement we have posted, so /build latest works and CI
      -- retries do not double-post.
      CREATE TABLE builds (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT NOT NULL,
        version       TEXT NOT NULL,
        channel       TEXT NOT NULL DEFAULT 'stable',
        platforms     TEXT,
        notes         TEXT,
        url           TEXT,
        source        TEXT NOT NULL DEFAULT 'manual',
        message_id    TEXT,
        created_at    INTEGER NOT NULL,
        UNIQUE (guild_id, version, channel)
      ) STRICT;

      CREATE INDEX idx_builds_guild_created ON builds (guild_id, created_at DESC);

      -- Audit trail for announcements and devlogs.
      CREATE TABLE posts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id    TEXT NOT NULL,
        kind        TEXT NOT NULL,
        author_id   TEXT NOT NULL,
        channel_id  TEXT NOT NULL,
        message_id  TEXT NOT NULL,
        title       TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX idx_posts_guild_kind ON posts (guild_id, kind, created_at DESC);
    `,
  },
  {
    id: 2,
    name: 'bilingual_content',
    sql: /* sql */ `
      -- A second public language. When set, everything the whole server sees
      -- (announcements, devlogs, the bug panel, the welcome message) is
      -- rendered in both, primary language first. NULL means monolingual.
      ALTER TABLE guild_config ADD COLUMN secondary_locale TEXT;

      -- Changelog per language, as a JSON object keyed by locale:
      --   {"en": "- Fixed the crash", "es": "- Arreglado el crash"}
      -- \`notes\` stays as the primary-language copy so existing rows and any
      -- CI still sending a single \`notes\` field keep working unchanged.
      ALTER TABLE builds ADD COLUMN notes_i18n TEXT;

      -- The language the report was filed in. A bug thread is a conversation
      -- with one person, so it should speak their language regardless of what
      -- the server's primary is.
      ALTER TABLE tickets ADD COLUMN locale TEXT;
    `,
  },
  {
    id: 3,
    name: 'command_access',
    sql: /* sql */ `
      -- Which roles may use which command, per server.
      --
      -- A row is a grant. No rows for a command means "unrestricted by us" —
      -- Discord's own default member permissions still apply, which is why the
      -- absence of rules is a safe default rather than an open door.
      --
      -- \`command\` is a top-level command name ('build', 'announce', ...) or
      -- '*', which stands for every command that has no list of its own.
      CREATE TABLE command_access (
        guild_id   TEXT NOT NULL,
        command    TEXT NOT NULL,
        role_id    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, command, role_id)
      ) STRICT;
    `,
  },
  {
    id: 4,
    name: 'self_roles',
    sql: /* sql */ `
      -- Roles members may give themselves from a button panel. Opt-in pings
      -- (a build-notification role nobody has to ask a moderator for) and
      -- self-declared groups: playtester, platform, language.
      --
      -- A component carries exactly one label no matter who is looking at it,
      -- so \`label\` is what the button says. \`label_i18n\` holds the per-locale
      -- copy, same JSON-keyed-by-locale shape as \`builds.notes_i18n\`, and a
      -- bilingual server joins them onto the one button.
      --
      -- Ordering is by \`created_at\`: re-adding a role updates it in place and
      -- deliberately leaves the timestamp alone, so editing a label never
      -- reshuffles the panel.
      CREATE TABLE self_roles (
        guild_id   TEXT NOT NULL,
        role_id    TEXT NOT NULL,
        label      TEXT NOT NULL,
        label_i18n TEXT,
        emoji      TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      ) STRICT;
    `,
  },
  {
    id: 5,
    name: 'welcome_background',
    sql: /* sql */ `
      -- Per-guild artwork for the welcome card. A URL, not the bytes: the
      -- database is backed up nightly and copied around, and an image per
      -- server would grow it by megabytes for something that is not data.
      --
      -- The image itself is cached on the data volume when it is set, so a
      -- Discord attachment URL keeps working after Discord's signature
      -- expires, and a member joining never waits on a network fetch.
      ALTER TABLE guild_config ADD COLUMN welcome_background_url TEXT;
    `,
  },
  {
    id: 6,
    name: 'per_language_channels',
    sql: /* sql */ `
      -- Where the *secondary* language goes, when it should not share a
      -- channel with the primary one.
      --
      -- NULL, the default, keeps the existing behaviour: one message carrying
      -- one embed per language. Set, and each language is published to its own
      -- channel as its own message, for servers that run #anuncios and
      -- #announcements side by side.
      --
      -- Tickets are deliberately absent. A report's thread already speaks the
      -- reporter's own language, and a thread has to live in one channel.
      ALTER TABLE guild_config ADD COLUMN announce_channel_secondary_id TEXT;
      ALTER TABLE guild_config ADD COLUMN devlog_channel_secondary_id   TEXT;
      ALTER TABLE guild_config ADD COLUMN build_channel_secondary_id    TEXT;
      ALTER TABLE guild_config ADD COLUMN welcome_channel_secondary_id  TEXT;
    `,
  },
];
