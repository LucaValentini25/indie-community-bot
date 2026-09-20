import { EmbedBuilder } from '@discordjs/builders';
import {
  ChannelType,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIOverwrite,
  type APIRole,
} from 'discord-api-types/v10';
import { getGuildConfig, type GuildConfig } from '../config/guild.js';
import {
  LOCALE_LABELS,
  localeFromDiscord,
  translator,
  type Locale,
  type Translate,
} from '../../../src/i18n/index.js';
import { parseHexColor } from '../../../src/lib/text.js';
import { channelPermissions, missingPermissions, Perm } from '../discord/permissions.js';
import { memo, type App } from '../types.js';

const FALLBACK_COLOR = 0x5865f2;

export interface GuildContext {
  readonly config: GuildConfig;
  /** Translator bound to a locale. Which one depends on how you got this. */
  readonly s: Translate;
  /** The locale `s` is bound to. */
  readonly locale: Locale;
}

/**
 * Context bound to the server's **primary** language. Use it for anything the
 * whole server sees; for a reply only one person sees, prefer `contextForUser`.
 */
export async function contextFor(app: App, guildId: string): Promise<GuildContext> {
  const config = await getGuildConfig(app, guildId);
  return { config, s: translator(config.locale), locale: config.locale };
}

/**
 * Context bound to the **viewer's own** language. Discord tells us what each
 * user has their client set to, so an ephemeral reply can be in their language
 * with no configuration. Falls back to the server's primary for a language we
 * do not speak.
 */
export async function contextForUser(
  app: App,
  guildId: string,
  discordLocale: string | null | undefined,
): Promise<GuildContext> {
  const config = await getGuildConfig(app, guildId);
  const locale = localeFromDiscord(discordLocale) ?? config.locale;
  return { config, s: translator(locale), locale };
}

/** The languages a public post is rendered in: primary, plus secondary if set. */
export function publicLocales(config: GuildConfig): Locale[] {
  return config.secondaryLocale && config.secondaryLocale !== config.locale
    ? [config.locale, config.secondaryLocale]
    : [config.locale];
}

export interface LocaleRenderer {
  readonly locale: Locale;
  /** The language's name in its own language, e.g. `ESPAÑOL`. */
  readonly label: string;
  readonly s: Translate;
}

/**
 * One renderer per public language, in display order. Callers that build
 * public content map over this instead of branching on "is it bilingual".
 */
export function localeRenderers(config: GuildConfig): LocaleRenderer[] {
  return publicLocales(config).map((locale) => ({
    locale,
    label: LOCALE_LABELS[locale],
    s: translator(locale),
  }));
}

/** An embed pre-tinted with the guild's accent color. */
export function brandedEmbed(config: GuildConfig): EmbedBuilder {
  return new EmbedBuilder().setColor(parseHexColor(config.accentColor) ?? FALLBACK_COLOR);
}

// ── What the bot can see of a guild ─────────────────────────────────────────
// Each is one API call, memoised per request. Free-plan Workers may make 50
// outgoing calls per request, which is far more than any command here needs.

export function getGuildInfo(app: App, guildId: string): Promise<APIGuild> {
  return memo(app, `guild:${guildId}`, () => app.rest.getGuild(guildId));
}

export function getGuildRoles(app: App, guildId: string): Promise<APIRole[]> {
  return memo(app, `roles:${guildId}`, () => app.rest.getGuildRoles(guildId));
}

/** The bot's own membership: its roles decide what it may do. */
export function getBotMember(app: App, guildId: string): Promise<APIGuildMember> {
  return memo(app, `me:${guildId}`, () => app.rest.getGuildMember(guildId, app.botId));
}

// ── Channels ────────────────────────────────────────────────────────────────

export interface SendableChannel {
  readonly id: string;
  readonly type: ChannelType;
}

export type ChannelLookup =
  | { ok: true; channel: SendableChannel }
  | { ok: false; reason: 'not-configured' | 'unavailable' }
  | { ok: false; reason: 'missing-permission'; missing: string; channel: SendableChannel };

const TEXT_CHANNELS: readonly ChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

const THREADS: readonly ChannelType[] = [
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

type ChannelWithOverwrites = APIChannel & {
  parent_id?: string | null;
  permission_overwrites?: APIOverwrite[];
};

/** What the bot is allowed to do in a channel, resolved from roles and overwrites. */
async function botPermissionsIn(app: App, guildId: string, channel: ChannelWithOverwrites): Promise<bigint> {
  const [roles, me] = await Promise.all([getGuildRoles(app, guildId), getBotMember(app, guildId)]);

  // A thread inherits its parent's overwrites and has none of its own.
  let source = channel;
  if (THREADS.includes(channel.type) && channel.parent_id) {
    source = (await app.rest.getChannel(channel.parent_id)) as ChannelWithOverwrites;
  }

  return channelPermissions({
    guildId,
    memberId: app.botId,
    memberRoleIds: me.roles,
    roles,
    overwrites: source.permission_overwrites ?? [],
  });
}

/**
 * Resolves a configured channel id to a channel we can actually post in.
 *
 * Returns a discriminated result instead of throwing, because every caller
 * wants to turn the failure into a different user-facing message.
 */
export async function resolveSendableChannel(
  app: App,
  guildId: string,
  channelId: string | null,
  required: readonly bigint[] = [Perm.ViewChannel, Perm.SendMessages],
): Promise<ChannelLookup> {
  if (!channelId) return { ok: false, reason: 'not-configured' };

  let channel: ChannelWithOverwrites;
  try {
    channel = (await app.rest.getChannel(channelId)) as ChannelWithOverwrites;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  // A channel from another server is as good as missing, and must not be
  // postable just because someone pasted its id.
  const owner = (channel as { guild_id?: string }).guild_id;
  if (!TEXT_CHANNELS.includes(channel.type) || owner !== guildId) return { ok: false, reason: 'unavailable' };

  // Threads have their own permission for sending.
  const needed = THREADS.includes(channel.type)
    ? required.map((flag) => (flag === Perm.SendMessages ? Perm.SendMessagesInThreads : flag))
    : required;

  let permissions: bigint;
  try {
    permissions = await botPermissionsIn(app, guildId, channel);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const missing = missingPermissions(permissions, needed);
  const found: SendableChannel = { id: channel.id, type: channel.type };

  if (missing.length > 0) {
    return { ok: false, reason: 'missing-permission', missing: missing.join(', '), channel: found };
  }

  return { ok: true, channel: found };
}

/** Turns a failed lookup into the right localized sentence. */
export function describeChannelFailure(lookup: Extract<ChannelLookup, { ok: false }>, s: Translate): string {
  switch (lookup.reason) {
    case 'not-configured':
      return s('common.channelNotConfigured');
    case 'unavailable':
      return s('common.channelUnavailable');
    case 'missing-permission':
      return s('common.missingBotPermission', {
        permissions: lookup.missing,
        channel: `<#${lookup.channel.id}>`,
      });
  }
}

/** One message of a public post: the channel it goes to, and the languages it carries. */
export interface PublicationTarget {
  readonly channel: SendableChannel;
  readonly renderers: LocaleRenderer[];
}

/**
 * Works out how a public post is split across channels, and resolves each one.
 *
 * With no secondary channel configured this is a single target carrying every
 * language — one message, one embed per language. Set one and each language
 * gets its own message in its own channel.
 *
 * **All or nothing.** Every channel is resolved before anything is sent, and
 * one unusable channel fails the whole publication: a devlog that went out in
 * Spanish but not English is worse than one that did not go out at all.
 */
export async function resolvePublicationTargets(
  app: App,
  guildId: string,
  config: GuildConfig,
  primaryChannelId: string | null,
  secondaryChannelId: string | null,
  required?: readonly bigint[],
): Promise<
  { ok: true; targets: PublicationTarget[] } | { ok: false; failure: Extract<ChannelLookup, { ok: false }> }
> {
  const renderers = localeRenderers(config);

  const primary = await resolveSendableChannel(app, guildId, primaryChannelId, required);
  if (!primary.ok) return { ok: false, failure: primary };

  const split =
    renderers.length > 1 && secondaryChannelId !== null && secondaryChannelId !== primary.channel.id;

  if (!split) return { ok: true, targets: [{ channel: primary.channel, renderers }] };

  const secondary = await resolveSendableChannel(app, guildId, secondaryChannelId, required);
  if (!secondary.ok) return { ok: false, failure: secondary };

  return {
    ok: true,
    targets: [
      { channel: primary.channel, renderers: [renderers[0]!] },
      { channel: secondary.channel, renderers: [renderers[1]!] },
    ],
  };
}
