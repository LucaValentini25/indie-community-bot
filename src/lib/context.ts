import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
  type PermissionResolvable,
} from 'discord.js';
import { getGuildConfig, type GuildConfig } from '../config/guild.js';
import { translator, type Translate } from '../i18n/index.js';
import { parseHexColor } from './text.js';

const FALLBACK_COLOR = 0x5865f2;

export interface GuildContext {
  readonly config: GuildConfig;
  /** Translator already bound to this guild's locale. */
  readonly s: Translate;
}

/** Loads config + translator for a guild. Cheap: config reads are cached. */
export function contextFor(guildId: string): GuildContext {
  const config = getGuildConfig(guildId);
  return { config, s: translator(config.locale) };
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
