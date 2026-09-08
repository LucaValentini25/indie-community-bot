import { db, queryOne, queryOneRequired } from '../db/index.js';
import { env } from './env.js';
import { isLocale, type Locale } from '../i18n/index.js';

/**
 * Per-guild settings. This is what makes the bot reusable: nothing about a
 * specific game or server is hardcoded — a second community only needs its own
 * row here, created automatically the first time we see the guild.
 */
export interface GuildConfig {
  guildId: string;
  /** The server's primary public language. */
  locale: Locale;
  /**
   * Optional second public language. When set, everything the whole server
   * sees is rendered in both, `locale` first. NULL means monolingual.
   */
  secondaryLocale: Locale | null;

  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeRoleId: string | null;

  announceChannelId: string | null;
  devlogChannelId: string | null;

  buildChannelId: string | null;
  buildRoleId: string | null;

  ticketChannelId: string | null;
  ticketStaffRoleId: string | null;
  ticketCounter: number;

  accentColor: string;
  gameName: string | null;

  createdAt: number;
  updatedAt: number;
}

interface GuildConfigRow {
  guild_id: string;
  locale: string;
  secondary_locale: string | null;
  welcome_enabled: number;
  welcome_channel_id: string | null;
  welcome_role_id: string | null;
  announce_channel_id: string | null;
  devlog_channel_id: string | null;
  build_channel_id: string | null;
  build_role_id: string | null;
  ticket_channel_id: string | null;
  ticket_staff_role_id: string | null;
  ticket_counter: number;
  accent_color: string;
  game_name: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Maps a camelCase field to its column. Also acts as the allowlist for
 * `updateGuildConfig`, so a caller can never inject a column name.
 */
const COLUMNS = {
  locale: 'locale',
  secondaryLocale: 'secondary_locale',
  welcomeEnabled: 'welcome_enabled',
  welcomeChannelId: 'welcome_channel_id',
  welcomeRoleId: 'welcome_role_id',
  announceChannelId: 'announce_channel_id',
  devlogChannelId: 'devlog_channel_id',
  buildChannelId: 'build_channel_id',
  buildRoleId: 'build_role_id',
  ticketChannelId: 'ticket_channel_id',
  ticketStaffRoleId: 'ticket_staff_role_id',
  ticketCounter: 'ticket_counter',
  accentColor: 'accent_color',
  gameName: 'game_name',
} as const satisfies Record<string, string>;

export type EditableField = keyof typeof COLUMNS;

/** Narrows a raw column value to a Locale, or null if it is not one we speak. */
function toLocale(value: string | null): Locale | null {
  return value !== null && isLocale(value) ? value : null;
}

function toConfig(row: GuildConfigRow): GuildConfig {
  return {
    guildId: row.guild_id,
    locale: toLocale(row.locale) ?? 'en',
    secondaryLocale: toLocale(row.secondary_locale),
    welcomeEnabled: row.welcome_enabled === 1,
    welcomeChannelId: row.welcome_channel_id,
    welcomeRoleId: row.welcome_role_id,
    announceChannelId: row.announce_channel_id,
    devlogChannelId: row.devlog_channel_id,
    buildChannelId: row.build_channel_id,
    buildRoleId: row.build_role_id,
    ticketChannelId: row.ticket_channel_id,
    ticketStaffRoleId: row.ticket_staff_role_id,
    ticketCounter: row.ticket_counter,
    accentColor: row.accent_color,
    gameName: row.game_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
