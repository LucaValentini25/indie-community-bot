import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
  type PermissionResolvable,
} from 'discord.js';
import { getGuildConfig, type GuildConfig } from '../config/guild.js';
import { LOCALE_LABELS, localeFromDiscord, translator, type Locale, type Translate } from '../i18n/index.js';
import { parseHexColor } from './text.js';

const FALLBACK_COLOR = 0x5865f2;

export interface GuildContext {
  readonly config: GuildConfig;
  /** Translator bound to a locale. Which one depends on how you got this. */
  readonly s: Translate;
  /** The locale `s` is bound to. */
  readonly locale: Locale;
}

/**
 * Context bound to the server's **primary** language.
 *
 * Use this for anything the whole server sees. For a reply only one person
 * sees, prefer `contextForUser` — in a bilingual community, showing someone an
 * error in a language they do not read is a bad default.
 */
export function contextFor(guildId: string): GuildContext {
  const config = getGuildConfig(guildId);
  return { config, s: translator(config.locale), locale: config.locale };
}

/**
 * Context bound to the **viewer's own** language.
 *
 * Discord tells us the language each user has their client set to, so an
 * ephemeral reply can be in their language with no configuration at all. We
 * only honour it when it is a language this bot actually speaks; otherwise we
 * fall back to the server's primary rather than silently defaulting to English.
 */
export function contextForUser(guildId: string, discordLocale: string | null | undefined): GuildContext {
  const config = getGuildConfig(guildId);
  const locale = localeFromDiscord(discordLocale) ?? config.locale;
  return { config, s: translator(locale), locale };
}

/**
 * The languages a public post should be rendered in: the primary, plus the
 * secondary when one is configured and different.
 */
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
 * public content map over this instead of branching on "is it bilingual" —
 * a monolingual server is just the one-element case.
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

/**
 * Resolves a configured channel id to a channel we can actually post in.
 *
 * Returns a discriminated result instead of throwing, because every caller
 * wants to turn the failure into a different user-facing message.
 */
export type ChannelLookup =
  | { ok: true; channel: GuildTextBasedChannel }
  | { ok: false; reason: 'not-configured' | 'unavailable' }
  | { ok: false; reason: 'missing-permission'; missing: string; channel: GuildTextBasedChannel };

export async function resolveSendableChannel(
  guild: Guild,
  channelId: string | null,
  required: PermissionResolvable[] = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
): Promise<ChannelLookup> {
  if (!channelId) return { ok: false, reason: 'not-configured' };

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (
    !channel ||
    !channel.isTextBased() ||
    channel.type === ChannelType.GuildStageVoice ||
    !('guild' in channel)
  ) {
    return { ok: false, reason: 'unavailable' };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return { ok: false, reason: 'unavailable' };

  const permissions = channel.permissionsFor(me);
  const missing = permissions?.missing(required) ?? required.map(String);

  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing-permission',
      missing: missing.join(', '),
      channel: channel as GuildTextBasedChannel,
    };
  }

  return { ok: true, channel: channel as GuildTextBasedChannel };
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
