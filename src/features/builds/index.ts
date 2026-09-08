import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from 'discord.js';
import { db, queryAll, queryOne } from '../../db/index.js';
import {
  brandedEmbed,
  contextFor,
  contextForUser,
  describeChannelFailure,
  localeRenderers,
  resolveSendableChannel,
} from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { isHttpUrl, truncate } from '../../lib/text.js';
import { isLocale, type Locale } from '../../i18n/index.js';

const log = createLogger('builds');

export interface BuildRecord {
  id: number;
  guild_id: string;
  version: string;
  channel: string;
  platforms: string | null;
  /** Primary-language changelog. Kept for rows written before notes_i18n. */
  notes: string | null;
  /** JSON object keyed by locale, e.g. `{"en":"…","es":"…"}`. */
  notes_i18n: string | null;
  url: string | null;
  source: string;
  message_id: string | null;
  created_at: number;
}

export type LocalizedNotes = Partial<Record<Locale, string>>;

export interface AnnounceBuildInput {
  guildId: string;
  /** Semantic-ish version string, e.g. `0.4.2` or `2026.09.07-nightly`. */
  version: string;
  /** Release channel / Steam branch: stable, beta, nightly, playtest… */
  channel?: string;
  /** Free text, e.g. `Windows, Linux, Steam Deck`. */
  platforms?: string | null;
  /**
   * Changelog for the server's primary language. The simple case, and what CI
   * that does not care about localisation keeps sending.
   */
  notes?: string | null;
  /**
   * Per-language changelog. Takes precedence over `notes` for any language it
   * covers, so a pipeline can send `{en, es}` and get a bilingual post.
   */
  notesByLocale?: LocalizedNotes;
  /** Link to the release / store page / build artifact. */
  url?: string | null;
  /** Where the announcement came from: `manual`, `github`, `steam`, … */
  source?: string;
  /** Skips the duplicate check. Used by `/build announce --force`. */
  force?: boolean;
  /**
   * Locale of the person who triggered this, when there is one. Only affects
   * the failure message they get back; CI leaves it unset.
   */
  viewerLocale?: string | null;
}

export type AnnounceBuildResult =
  | { ok: true; channelId: string; messageId: string }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'guild-unavailable' }
  | { ok: false; reason: 'channel'; message: string };

/**
 * The single path through which a build announcement is posted.
 *
 * Both `/build announce` and `POST /hooks/build` call this, so CI-driven and
 * manual announcements are guaranteed to look identical and to be recorded the
 * same way.
 */
export async function announceBuild(client: Client, input: AnnounceBuildInput): Promise<AnnounceBuildResult> {
  const channelName = (input.channel ?? 'stable').trim().toLowerCase();
  const source = input.source ?? 'manual';

  const guild = await client.guilds.fetch(input.guildId).catch(() => null);
  if (!guild) return { ok: false, reason: 'guild-unavailable' };

  const { config } = contextFor(input.guildId);
  // Errors go back to whoever asked; the announcement itself does not.
  const { s } = contextForUser(input.guildId, input.viewerLocale);

  // CI retries and re-runs are common; without this a re-run would double-post.
  if (!input.force && findBuild(input.guildId, input.version, channelName)) {
    return { ok: false, reason: 'duplicate' };
  }

  const lookup = await resolveSendableChannel(guild, config.buildChannelId);
  if (!lookup.ok) {
    return { ok: false, reason: 'channel', message: describeChannelFailure(lookup, s) };
  }

  // `notes` fills in for the primary language only. A secondary language with
  // no changelog of its own gets no block rather than an English one.
  const notes: LocalizedNotes = { ...input.notesByLocale };
  if (input.notes?.trim() && !notes[config.locale]) notes[config.locale] = input.notes.trim();

  const renderers = localeRenderers(config);
  // The first language always gets a block — it carries the title and metadata
  // even when there is no changelog. The rest earn theirs by having text.
  const blocks = renderers.filter((renderer, index) => index === 0 || notes[renderer.locale]?.trim());
  const bilingual = blocks.length > 1;

  const embeds = blocks.map((renderer, index) => {
    const isFirst = index === 0;
    const isLast = index === blocks.length - 1;

    const embed = brandedEmbed(config).setAuthor({
      name: bilingual ? `${renderer.label} · ${renderer.s('build.newBuild')}` : renderer.s('build.newBuild'),
    });

    // The title is the game name and a version number — identical in every
    // language, so repeating it per block would just be noise.
    if (isFirst) {
      embed.setTitle(
        config.gameName
          ? renderer.s('build.titleWithGame', { game: config.gameName, version: input.version })
          : renderer.s('build.titleWithoutGame', { version: input.version }),
      );
      if (input.url && isHttpUrl(input.url)) embed.setURL(input.url);
    }

    const body = notes[renderer.locale]?.trim();
    if (body) embed.setDescription(truncate(body, 4000));

    // Metadata once, at the bottom of the message.
    if (isLast) {
      embed.addFields({ name: renderer.s('build.fieldChannel'), value: `\`${channelName}\``, inline: true });
      if (input.platforms?.trim()) {
        embed.addFields({
          name: renderer.s('build.fieldPlatforms'),
          value: input.platforms.trim(),
          inline: true,
        });
      }
      embed.setFooter({ text: renderer.s('build.footerSource', { source }) }).setTimestamp(new Date());
    }

    return embed;
  });

  const components = [];
  if (input.url && isHttpUrl(input.url)) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(s('build.download')).setURL(input.url),
      ),
    );
  }

  const message = await lookup.channel.send({
    content: config.buildRoleId ? `<@&${config.buildRoleId}>` : undefined,
    embeds,
    components,
    // Explicit allowlist: the role ping is intentional, everything else in the
    // changelog text (@everyone, stray @mentions) must stay inert.
    allowedMentions: config.buildRoleId ? { roles: [config.buildRoleId] } : { parse: [] },
  });

  recordBuild({
    guildId: input.guildId,
    version: input.version,
    channel: channelName,
    platforms: input.platforms ?? null,
    notes: notes[config.locale] ?? null,
    notesI18n: Object.keys(notes).length > 0 ? JSON.stringify(notes) : null,
    url: input.url ?? null,
    source,
    messageId: message.id,
  });

  log.info(
    {
      guild: input.guildId,
      version: input.version,
      channel: channelName,
      source,
      locales: blocks.map((renderer) => renderer.locale),
    },
    'build announced',
  );

  return { ok: true, channelId: lookup.channel.id, messageId: message.id };
}

/**
 * Reads a stored changelog back in the requested language, falling back to the
 * primary-language copy. Used by `/build latest`, which is ephemeral and so
 * renders in the *viewer's* language.
 */
export function notesForLocale(build: BuildRecord, locale: Locale): string | null {
  if (build.notes_i18n) {
    try {
      const parsed = JSON.parse(build.notes_i18n) as Record<string, unknown>;
      const value = parsed[locale];
      if (typeof value === 'string' && value.trim()) return value;
    } catch {
      // A malformed blob is not worth failing a command over.
    }
  }
  return build.notes;
}

/** All languages a stored build has a changelog for. */
export function notesLocales(build: BuildRecord): Locale[] {
  if (!build.notes_i18n) return [];
  try {
    return Object.keys(JSON.parse(build.notes_i18n) as Record<string, unknown>).filter(isLocale);
  } catch {
    return [];
  }
}

function findBuild(guildId: string, version: string, channel: string): BuildRecord | undefined {
  return queryOne<BuildRecord>(
    'SELECT * FROM builds WHERE guild_id = ? AND version = ? AND channel = ?',
    guildId,
    version,
    channel,
  );
}

function recordBuild(input: {
  guildId: string;
  version: string;
  channel: string;
  platforms: string | null;
  notes: string | null;
  notesI18n: string | null;
  url: string | null;
  source: string;
  messageId: string;
}): void {
  db.prepare(
    `INSERT INTO builds (guild_id, version, channel, platforms, notes, notes_i18n, url, source, message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, version, channel) DO UPDATE SET
       platforms = excluded.platforms,
       notes = excluded.notes,
       notes_i18n = excluded.notes_i18n,
       url = excluded.url,
       source = excluded.source,
       message_id = excluded.message_id,
       created_at = excluded.created_at`,
  ).run(
    input.guildId,
    input.version,
    input.channel,
    input.platforms,
    input.notes,
    input.notesI18n,
    input.url,
    input.source,
    input.messageId,
    Date.now(),
  );
}

export function latestBuild(guildId: string, channel?: string): BuildRecord | undefined {
  if (channel) {
    return queryOne<BuildRecord>(
      'SELECT * FROM builds WHERE guild_id = ? AND channel = ? ORDER BY created_at DESC LIMIT 1',
      guildId,
      channel,
    );
  }
  return queryOne<BuildRecord>(
    'SELECT * FROM builds WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1',
    guildId,
  );
}

export function recentBuilds(guildId: string, limit = 10): BuildRecord[] {
  return queryAll<BuildRecord>(
    'SELECT * FROM builds WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
    guildId,
    limit,
  );
}
