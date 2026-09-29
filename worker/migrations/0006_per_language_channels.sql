-- Generated from src/db/migrations.ts (id 6). Do not edit by hand:
-- change the source and run `npm run worker:migrations`.
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
    