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
];
