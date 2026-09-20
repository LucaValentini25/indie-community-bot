-- Generated from src/db/migrations.ts (id 3). Do not edit by hand:
-- change the source and run `npm run worker:migrations`.
      -- Which roles may use which command, per server.
      --
      -- A row is a grant. No rows for a command means "unrestricted by us" —
      -- Discord's own default member permissions still apply, which is why the
      -- absence of rules is a safe default rather than an open door.
      --
      -- `command` is a top-level command name ('build', 'announce', ...) or
      -- '*', which stands for every command that has no list of its own.
      CREATE TABLE command_access (
        guild_id   TEXT NOT NULL,
        command    TEXT NOT NULL,
        role_id    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, command, role_id)
      ) STRICT;
    