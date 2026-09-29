import {
  COLUMNS,
  toConfig,
  type EditableField,
  type GuildConfig,
  type GuildConfigRow,
} from '../../../src/config/guild-model.js';
import { isLocale } from '../../../src/i18n/index.js';
import { memo, type App } from '../types.js';

export type { EditableField, GuildConfig };

/**
 * The guild's settings, creating a default row the first time we see it.
 *
 * Memoised for the length of one request only — see `App` for why nothing is
 * cached across requests. `INSERT ... DO NOTHING` makes two simultaneous first
 * requests safe: one wins, both then read the same row.
 */
export function getGuildConfig(app: App, guildId: string): Promise<GuildConfig> {
  return memo(app, `config:${guildId}`, async () => {
    const existing = await app.db.first<GuildConfigRow>(
      'SELECT * FROM guild_config WHERE guild_id = ?',
      guildId,
    );
    if (existing) return toConfig(existing);

    const now = Date.now();
    const fallback = app.env.DEFAULT_LOCALE;
    await app.db.run(
      'INSERT INTO guild_config (guild_id, locale, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id) DO NOTHING',
      guildId,
      fallback && isLocale(fallback) ? fallback : 'en',
      now,
      now,
    );

    return toConfig(
      await app.db.firstRequired<GuildConfigRow>('SELECT * FROM guild_config WHERE guild_id = ?', guildId),
    );
  });
}

/** Applies a partial update and returns the fresh config. */
export async function updateGuildConfig(
  app: App,
  guildId: string,
  patch: Partial<Pick<GuildConfig, EditableField>>,
): Promise<GuildConfig> {
  await getGuildConfig(app, guildId); // guarantees the row exists

  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [field, value] of Object.entries(patch)) {
    const column = COLUMNS[field as EditableField];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    values.push(
      typeof value === 'boolean' ? (value ? 1 : 0) : ((value as string | number | null | undefined) ?? null),
    );
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?');
    values.push(Date.now(), guildId);
    await app.db.run(`UPDATE guild_config SET ${assignments.join(', ')} WHERE guild_id = ?`, ...values);
    app.memo.delete(`config:${guildId}`);
  }

  return getGuildConfig(app, guildId);
}

/** Atomically increments and returns the guild's next ticket number. */
export async function nextTicketNumber(app: App, guildId: string): Promise<number> {
  await getGuildConfig(app, guildId);
  const row = await app.db.firstRequired<{ ticket_counter: number }>(
    'UPDATE guild_config SET ticket_counter = ticket_counter + 1, updated_at = ? WHERE guild_id = ? RETURNING ticket_counter',
    Date.now(),
    guildId,
  );
  app.memo.delete(`config:${guildId}`);
  return row.ticket_counter;
}
