-- Generated from src/db/migrations.ts (id 2). Do not edit by hand:
-- change the source and run `npm run worker:migrations`.
      -- A second public language. When set, everything the whole server sees
      -- (announcements, devlogs, the bug panel, the welcome message) is
      -- rendered in both, primary language first. NULL means monolingual.
      ALTER TABLE guild_config ADD COLUMN secondary_locale TEXT;

      -- Changelog per language, as a JSON object keyed by locale:
      --   {"en": "- Fixed the crash", "es": "- Arreglado el crash"}
      -- `notes` stays as the primary-language copy so existing rows and any
      -- CI still sending a single `notes` field keep working unchanged.
      ALTER TABLE builds ADD COLUMN notes_i18n TEXT;

      -- The language the report was filed in. A bug thread is a conversation
      -- with one person, so it should speak their language regardless of what
      -- the server's primary is.
      ALTER TABLE tickets ADD COLUMN locale TEXT;
    