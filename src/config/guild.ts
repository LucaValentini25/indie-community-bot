import { db, queryOne, queryOneRequired } from '../db/index.js';
import { env } from './env.js';
import {
  COLUMNS,
  toConfig,
  type EditableField,
  type GuildConfig,
  type GuildConfigRow,
} from './guild-model.js';

// The model lives in guild-model.ts so the serverless Worker can share it.
export type { EditableField, GuildConfig };

/**
 * Reads are on the hot path of every interaction, so we keep the row in
 * memory. The cache is invalidated on write, and the process is the only
 * writer, so it cannot go stale.
 */
const cache = new Map<string, GuildConfig>();

/** Returns the guild's config, creating a default row the first time. */
export function getGuildConfig(guildId: string): GuildConfig {
  const cached = cache.get(guildId);
  if (cached) return cached;

  const row = queryOne<GuildConfigRow>('SELECT * FROM guild_config WHERE guild_id = ?', guildId);

  if (row) {
    const config = toConfig(row);
    cache.set(guildId, config);
    return config;
  }

  const now = Date.now();
  db.prepare(`INSERT INTO guild_config (guild_id, locale, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    guildId,
    env.DEFAULT_LOCALE,
    now,
    now,
  );

  return getGuildConfig(guildId);
}

/** Applies a partial update and returns the fresh config. */
export function updateGuildConfig(
  guildId: string,
  patch: Partial<Pick<GuildConfig, EditableField>>,
): GuildConfig {
  getGuildConfig(guildId); // guarantees the row exists

  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [field, value] of Object.entries(patch)) {
    const column = COLUMNS[field as EditableField];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null));
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?');
    values.push(Date.now(), guildId);
    db.prepare(`UPDATE guild_config SET ${assignments.join(', ')} WHERE guild_id = ?`).run(...values);
    cache.delete(guildId);
  }

  return getGuildConfig(guildId);
}

/** Atomically increments and returns the guild's next ticket number. */
export function nextTicketNumber(guildId: string): number {
  getGuildConfig(guildId);
  const row = queryOneRequired<{ ticket_counter: number }>(
    'UPDATE guild_config SET ticket_counter = ticket_counter + 1, updated_at = ? WHERE guild_id = ? RETURNING ticket_counter',
    Date.now(),
    guildId,
  );
  cache.delete(guildId);
  return row.ticket_counter;
}

export function forgetGuildConfig(guildId: string): void {
  cache.delete(guildId);
}
