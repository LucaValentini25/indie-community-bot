import { AttachmentBuilder, type GuildMember, type GuildTextBasedChannel } from 'discord.js';
import { contextFor, resolveSendableChannel } from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { renderWelcomeCard } from './card.js';

const log = createLogger('welcome');

/**
 * Renders and posts the welcome card for a member.
 *
 * `channelOverride` is used by `/welcome test`, which previews the card in the
 * channel the command was run from without touching the configured one.
 *
 * Never throws: a failure here must not take down the join handler, and the
 * member should still get their auto-role.
 */
export async function sendWelcome(
  member: GuildMember,
  channelOverride?: GuildTextBasedChannel,
): Promise<boolean> {
  const { config, s } = contextFor(member.guild.id);

  let target = channelOverride;

  if (!target) {
    if (!config.welcomeEnabled) return false;

    const lookup = await resolveSendableChannel(member.guild, config.welcomeChannelId, [
      'ViewChannel',
      'SendMessages',
      'AttachFiles',
    ]);

    if (!lookup.ok) {
      log.warn({ guild: member.guild.id, reason: lookup.reason }, 'welcome channel unusable');
      return false;
    }
    target = lookup.channel;
  }

  try {
    const card = await renderWelcomeCard({
      username: member.user.displayName || member.user.username,
      avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
      title: s('welcome.cardTitle'),
      subtitle: s('welcome.cardSubtitle', { count: member.guild.memberCount }),
      footer: config.gameName,
      accentColor: config.accentColor,
    });

    const message = config.gameName
      ? s('welcome.messageWithGame', { user: `<@${member.id}>`, game: config.gameName })
      : s('welcome.message', { user: `<@${member.id}>`, guild: member.guild.name });

    await target.send({
      content: message,
      files: [new AttachmentBuilder(card, { name: `welcome-${member.id}.png` })],
      allowedMentions: { users: [member.id] },
    });

    log.info({ guild: member.guild.id, member: member.id }, 'welcome card sent');
    return true;
  } catch (error) {
    log.error({ err: error, guild: member.guild.id, member: member.id }, 'failed to send welcome card');
    return false;
  }
}

/** Applies the configured join role, if any. Failures are logged, not thrown. */
export async function applyJoinRole(member: GuildMember): Promise<void> {
  const { config } = contextFor(member.guild.id);
  if (!config.welcomeRoleId) return;

  try {
    await member.roles.add(config.welcomeRoleId, 'Automatic role on join');
  } catch (error) {
    // Almost always: the bot's highest role sits below the target role.
    log.warn(
      { err: error, guild: member.guild.id, role: config.welcomeRoleId },
      'could not apply join role — check role hierarchy and Manage Roles',
    );
  }
}
