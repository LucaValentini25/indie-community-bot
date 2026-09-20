import { ActionRowBuilder, ButtonBuilder } from '@discordjs/builders';
import { ButtonStyle } from 'discord-api-types/v10';
import {
  brandedEmbed,
  contextFor,
  contextForUser,
  describeChannelFailure,
  resolvePublicationTargets,
} from '../lib/context.js';
import { createLogger } from '../logger.js';
import { isHttpUrl, truncate } from '../../../src/lib/text.js';
import { isLocale, type Locale } from '../../../src/i18n/index.js';
import type { App } from '../types.js';

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
  /** Changelog for the server's primary language — the simple case. */
  notes?: string | null;
  /** Per-language changelog. Takes precedence over `notes` for any language it covers. */
  notesByLocale?: LocalizedNotes;
  /** Link to the release / store page / build artifact. */
  url?: string | null;
  /** Where the announcement came from: `manual`, `github`, `steam`, … */
  source?: string;
  /** Skips the duplicate check. Used by `/build announce force:true`. */
  force?: boolean;
  /** Locale of whoever triggered this, when there is one. Only shapes their error message. */
  viewerLocale?: string | null;
}

export type AnnounceBuildResult =
  | { ok: true; channelId: string; messageId: string }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'guild-unavailable' }
  | { ok: false; reason: 'channel'; message: string };

/**
 * The single path through which a build announcement is posted. Both
 * `/build announce` and `POST /hooks/build` call it, so CI-driven and manual
 * announcements look identical and are recorded the same way.
 */
export async function announceBuild(app: App, input: AnnounceBuildInput): Promise<AnnounceBuildResult> {
  const channelName = (input.channel ?? 'stable').trim().toLowerCase();
  const source = input.source ?? 'manual';

  // The bot has to be in the server for anything below to work.
  const guild = await app.rest.getGuild(input.guildId).catch(() => null);
  if (!guild) return { ok: false, reason: 'guild-unavailable' };

  const { config } = await contextFor(app, input.guildId);
  const { s } = await contextForUser(app, input.guildId, input.viewerLocale);

  // CI retries and re-runs are common; without this a re-run would double-post.
  if (!input.force && (await findBuild(app, input.guildId, input.version, channelName))) {
    return { ok: false, reason: 'duplicate' };
  }

  const resolved = await resolvePublicationTargets(
    app,
    input.guildId,
    config,
    config.buildChannelId,
    config.buildChannelSecondaryId,
  );
  if (!resolved.ok) {
    return { ok: false, reason: 'channel', message: describeChannelFailure(resolved.failure, s) };
  }

  // `notes` fills in for the primary language only. A secondary language with
  // no changelog of its own gets no block rather than an English one.
  const notes: LocalizedNotes = { ...input.notesByLocale };
  if (input.notes?.trim() && !notes[config.locale]) notes[config.locale] = input.notes.trim();

  const sent: { channelId: string; messageId: string }[] = [];

  for (const target of resolved.targets) {
    // The first language always gets a block — it carries the title and
    // metadata even when there is no changelog. The rest earn theirs by text.
    const blocks = target.renderers.filter(
      (renderer, index) => index === 0 || notes[renderer.locale]?.trim(),
    );
    const bilingual = blocks.length > 1;

    const embeds = blocks.map((renderer, index) => {
      const isFirst = index === 0;
      const isLast = index === blocks.length - 1;

      const embed = brandedEmbed(config).setAuthor({
        name: bilingual
          ? `${renderer.label} · ${renderer.s('build.newBuild')}`
          : renderer.s('build.newBuild'),
      });

      // The title is the game name and a version number — the same in every
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
        embed.addFields({
          name: renderer.s('build.fieldChannel'),
          value: `\`${channelName}\``,
          inline: true,
        });
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
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(blocks[0]!.s('build.download'))
            .setURL(input.url),
        ),
      );
    }

    const message = await app.rest.createMessage(target.channel.id, {
      content: config.buildRoleId ? `<@&${config.buildRoleId}>` : undefined,
      embeds: embeds.map((embed) => embed.toJSON()),
      components: components.map((row) => row.toJSON()),
      // Explicit allowlist: the role ping is intentional, everything else in
      // the changelog text (@everyone, stray @mentions) must stay inert.
      allowed_mentions: config.buildRoleId ? { roles: [config.buildRoleId] } : { parse: [] },
    });

    sent.push({ channelId: target.channel.id, messageId: message.id });
  }

  await recordBuild(app, {
    guildId: input.guildId,
    version: input.version,
    channel: channelName,
    platforms: input.platforms ?? null,
    notes: notes[config.locale] ?? null,
    notesI18n: Object.keys(notes).length > 0 ? JSON.stringify(notes) : null,
    url: input.url ?? null,
    source,
    // The table holds one message id. With a split post that is the primary
    // language's, which is what /build latest links to.
    messageId: sent[0]!.messageId,
  });

  log.info({ guild: input.guildId, version: input.version, channel: channelName, source }, 'build announced');

  return { ok: true, channelId: sent[0]!.channelId, messageId: sent[0]!.messageId };
}

/**
 * Reads a stored changelog back in the requested language, falling back to the
 * primary-language copy. `/build latest` is ephemeral, so it renders in the
 * *viewer's* language.
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

function findBuild(
  app: App,
  guildId: string,
  version: string,
  channel: string,
): Promise<BuildRecord | undefined> {
  return app.db.first<BuildRecord>(
    'SELECT * FROM builds WHERE guild_id = ? AND version = ? AND channel = ?',
    guildId,
    version,
    channel,
  );
}

async function recordBuild(
  app: App,
  input: {
    guildId: string;
    version: string;
    channel: string;
    platforms: string | null;
    notes: string | null;
    notesI18n: string | null;
    url: string | null;
    source: string;
    messageId: string;
  },
): Promise<void> {
  await app.db.run(
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

export function latestBuild(app: App, guildId: string, channel?: string): Promise<BuildRecord | undefined> {
  if (channel) {
    return app.db.first<BuildRecord>(
      'SELECT * FROM builds WHERE guild_id = ? AND channel = ? ORDER BY created_at DESC LIMIT 1',
      guildId,
      channel,
    );
  }
  return app.db.first<BuildRecord>(
    'SELECT * FROM builds WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1',
    guildId,
  );
}

export function recentBuilds(app: App, guildId: string, limit = 10): Promise<BuildRecord[]> {
  return app.db.all<BuildRecord>(
    'SELECT * FROM builds WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
    guildId,
    limit,
  );
}
