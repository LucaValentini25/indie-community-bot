import { AttachmentBuilder, type GuildMember, type GuildTextBasedChannel } from 'discord.js';
import {
  contextFor,
  localeRenderers,
  resolvePublicationTargets,
  type PublicationTarget,
} from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { renderWelcomeCard } from './card.js';
import { cachedBackground } from './background.js';

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
  const { config } = contextFor(member.guild.id);

  // A join message is read by the whole server, so it uses every public
  // language rather than guessing at the new member's.
  let targets: PublicationTarget[];

  if (channelOverride) {
    // `/welcome test` previews in the channel it was run from, undivided — the
    // point is to see the card, not to rehearse the routing.
    targets = [{ channel: channelOverride, renderers: localeRenderers(config) }];
  } else {
    if (!config.welcomeEnabled) return false;

    const resolved = await resolvePublicationTargets(
      member.guild,
      config,
      config.welcomeChannelId,
      config.welcomeChannelSecondaryId,
      ['ViewChannel', 'SendMessages', 'AttachFiles'],
    );

    if (!resolved.ok) {
      log.warn({ guild: member.guild.id, reason: resolved.failure.reason }, 'welcome channel unusable');
      return false;
    }
    targets = resolved.targets;
  }

  try {
    for (const target of targets) {
      const renderers = target.renderers;

      // Rendered per message, not once: the heading is drawn into the image, so
      // a message carrying one language must not show the other's.
      const card = await renderWelcomeCard({
        username: member.user.displayName || member.user.username,
        avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
        // "WELCOME · BIENVENIDO" — short enough to stay on one line.
        title: renderers.map((renderer) => renderer.s('welcome.cardTitle')).join(' · '),
        // The member number is the same in any language, so it is not worth
        // doubling; the first language of this message carries it.
        subtitle: renderers[0]!.s('welcome.cardSubtitle', { count: member.guild.memberCount }),
        footer: config.gameName,
        accentColor: config.accentColor,
        // Prefer the cached file: it renders without touching the network and
        // survives a Discord attachment URL expiring. The URL is the fallback
        // for when the cache was lost, e.g. a fresh volume.
        backgroundUrl: cachedBackground(member.guild.id) ?? config.welcomeBackgroundUrl,
      });

      const message = renderers
        .map((renderer) =>
          config.gameName
            ? renderer.s('welcome.messageWithGame', { user: `<@${member.id}>`, game: config.gameName })
            : renderer.s('welcome.message', { user: `<@${member.id}>`, guild: member.guild.name }),
        )
        .join('\n');

      await target.channel.send({
        content: message,
        files: [new AttachmentBuilder(card, { name: `welcome-${member.id}.png` })],
        allowedMentions: { users: [member.id] },
      });
    }

    log.info({ guild: member.guild.id, member: member.id, messages: targets.length }, 'welcome card sent');
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
