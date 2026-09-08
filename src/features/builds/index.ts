import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from 'discord.js';
import { db, queryAll, queryOne } from '../../db/index.js';
import {
  brandedEmbed,
  contextFor,
  describeChannelFailure,
  resolveSendableChannel,
} from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { isHttpUrl, truncate } from '../../lib/text.js';

const log = createLogger('builds');

export interface BuildRecord {
  id: number;
  guild_id: string;
  version: string;
  channel: string;
  platforms: string | null;
  notes: string | null;
  url: string | null;
  source: string;
  message_id: string | null;
  created_at: number;
}

export interface AnnounceBuildInput {
  guildId: string;
  /** Semantic-ish version string, e.g. `0.4.2` or `2026.09.07-nightly`. */
  version: string;
  /** Release channel / Steam branch: stable, beta, nightly, playtest… */
  channel?: string;
  /** Free text, e.g. `Windows, Linux, Steam Deck`. */
  platforms?: string | null;
  /** Changelog. Markdown is fine. */
  notes?: string | null;
  /** Link to the release / store page / build artifact. */
  url?: string | null;
  /** Where the announcement came from: `manual`, `github`, `steam`, … */
  source?: string;
  /** Skips the duplicate check. Used by `/build announce --force`. */
  force?: boolean;
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

  const { config, s } = contextFor(input.guildId);

  // CI retries and re-runs are common; without this a re-run would double-post.
  if (!input.force && findBuild(input.guildId, input.version, channelName)) {
    return { ok: false, reason: 'duplicate' };
  }

  const lookup = await resolveSendableChannel(guild, config.buildChannelId);
  if (!lookup.ok) {
    return { ok: false, reason: 'channel', message: describeChannelFailure(lookup, s) };
  }

  const embed = brandedEmbed(config)
    .setAuthor({ name: s('build.newBuild') })
    .setTitle(
      config.gameName
        ? s('build.titleWithGame', { game: config.gameName, version: input.version })
        : s('build.titleWithoutGame', { version: input.version }),
    )
    .setTimestamp(new Date());

  if (input.url && isHttpUrl(input.url)) embed.setURL(input.url);
  if (input.notes?.trim()) embed.setDescription(truncate(input.notes.trim(), 4000));

  embed.addFields({ name: s('build.fieldChannel'), value: `\`${channelName}\``, inline: true });
  if (input.platforms?.trim()) {
    embed.addFields({ name: s('build.fieldPlatforms'), value: input.platforms.trim(), inline: true });
  }
  embed.setFooter({ text: s('build.footerSource', { source }) });

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
    embeds: [embed],
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
    notes: input.notes ?? null,
    url: input.url ?? null,
    source,
    messageId: message.id,
  });

  log.info({ guild: input.guildId, version: input.version, channel: channelName, source }, 'build announced');

  return { ok: true, channelId: lookup.channel.id, messageId: message.id };
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
  url: string | null;
  source: string;
  messageId: string;
}): void {
  db.prepare(
    `INSERT INTO builds (guild_id, version, channel, platforms, notes, url, source, message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, version, channel) DO UPDATE SET
       platforms = excluded.platforms,
       notes = excluded.notes,
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
