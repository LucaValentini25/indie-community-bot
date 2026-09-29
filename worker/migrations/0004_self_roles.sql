-- Generated from src/db/migrations.ts (id 4). Do not edit by hand:
-- change the source and run `npm run worker:migrations`.
      -- Roles members may give themselves from a button panel. Opt-in pings
      -- (a build-notification role nobody has to ask a moderator for) and
      -- self-declared groups: playtester, platform, language.
      --
      -- A component carries exactly one label no matter who is looking at it,
      -- so `label` is what the button says. `label_i18n` holds the per-locale
      -- copy, same JSON-keyed-by-locale shape as `builds.notes_i18n`, and a
      -- bilingual server joins them onto the one button.
      --
      -- Ordering is by `created_at`: re-adding a role updates it in place and
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
    