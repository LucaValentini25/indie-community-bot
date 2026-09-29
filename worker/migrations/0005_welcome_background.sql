-- Generated from src/db/migrations.ts (id 5). Do not edit by hand:
-- change the source and run `npm run worker:migrations`.
      -- Per-guild artwork for the welcome card. A URL, not the bytes: the
      -- database is backed up nightly and copied around, and an image per
      -- server would grow it by megabytes for something that is not data.
      --
      -- The image itself is cached on the data volume when it is set, so a
      -- Discord attachment URL keeps working after Discord's signature
      -- expires, and a member joining never waits on a network fetch.
      ALTER TABLE guild_config ADD COLUMN welcome_background_url TEXT;
    