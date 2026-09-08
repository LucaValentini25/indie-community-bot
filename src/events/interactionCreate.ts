import {
  Events,
  MessageFlags,
  type GuildMember,
  type Interaction,
  type RepliableInteraction,
} from 'discord.js';
import { defineEvent } from '../core/types.js';
import { createLogger } from '../core/logger.js';
import { checkCommandAccess } from '../config/access.js';
import { contextForUser } from '../lib/context.js';
import type { BotClient } from '../core/client.js';
import { handlePostModal, isPostModal } from '../features/announcements/modal.js';
import { handleSelfRoleToggle } from '../features/selfroles/index.js';
import {
  TicketIds,
  handleClaim,
  handleCloseRequest,
  handleReopen,
  handleReportSubmit,
  handleResolve,
  showReportModal,
} from '../features/tickets/index.js';

const log = createLogger('interactions');

/**
 * Single entry point for every interaction.
 *
 * Component custom IDs follow `feature:action[:id]`, so routing is a prefix
 * match on the first segment. Handlers may throw freely: this router catches,
 * logs with full context, and shows the user one generic message rather than
 * leaving the interaction hanging as "application did not respond".
 *
 * It is also the single place the per-guild role gate is enforced, so a command
 * file cannot forget to check it. See `config/access.ts`.
 */
export default defineEvent({
  name: Events.InteractionCreate,

  async execute(interaction: Interaction) {
    try {
      if (interaction.isAutocomplete()) {
        // Gated as well as the command itself: suggestions are drawn from the
        // guild's own data, so they should not be readable by someone who is
        // not allowed to run the command they belong to.
        const member = interaction.member as GuildMember | null;
        if (!checkCommandAccess(member, interaction.commandName).allowed) {
          await interaction.respond([]);
          return;
        }

        const command = (interaction.client as BotClient).commands.get(interaction.commandName);
        await command?.autocomplete?.(interaction);
        return;
      }

      // Everything below needs a guild: this bot has no DM surface.
      if (!interaction.inGuild() || !interaction.guild) {
        if (interaction.isRepliable()) {
          await interaction.reply({
            content: 'This bot only works inside a server.',
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = (interaction.client as BotClient).commands.get(interaction.commandName);

        if (!command) {
          log.warn({ command: interaction.commandName }, 'received an unknown command');
          await interaction.reply({
            content: 'That command no longer exists. Try re-inviting the bot.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const decision = checkCommandAccess(interaction.member as GuildMember | null, command.data.name);

        if (!decision.allowed) {
          const { s } = contextForUser(interaction.guild.id, interaction.locale);
          await interaction.reply({
            content:
              decision.requiredRoles.length > 0
                ? s('access.denied', {
                    roles: decision.requiredRoles.map((id) => `<@&${id}>`).join(', '),
                  })
                : s('common.missingPermission'),
            // Naming the roles is the point of the message, not a ping.
            allowedMentions: { parse: [] },
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        const [feature, action, id] = interaction.customId.split(':');

        if (feature === 'selfrole' && action === 'toggle' && id) {
          await handleSelfRoleToggle(interaction, id);
          return;
        }

        if (feature !== 'ticket') return;

        switch (action) {
          case 'open':
            await showReportModal(interaction);
            return;
          case 'claim':
            await handleClaim(interaction, Number(id));
            return;
          case 'close':
            await handleCloseRequest(interaction, Number(id));
            return;
          case 'reopen':
            await handleReopen(interaction, Number(id));
            return;
        }
        return;
      }

      if (interaction.isStringSelectMenu()) {
        const [feature, action, id] = interaction.customId.split(':');
        if (feature === 'ticket' && action === 'resolve') {
          await handleResolve(interaction, Number(id));
        }
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === TicketIds.modal) {
          await handleReportSubmit(interaction);
          return;
        }
        if (isPostModal(interaction.customId)) {
          await handlePostModal(interaction);
          return;
        }
      }
    } catch (error) {
      log.error(
        {
          err: error,
          guild: interaction.guildId,
          user: interaction.user.id,
          type: interaction.type,
          customId: 'customId' in interaction ? interaction.customId : undefined,
          command: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        },
        'interaction handler threw',
      );

      if (interaction.isRepliable()) await replyWithError(interaction);
    }
  },
});

/** Replies (or edits, if we already deferred) with the localized error text. */
async function replyWithError(interaction: RepliableInteraction): Promise<void> {
  const message = interaction.guildId
    ? contextForUser(interaction.guildId, interaction.locale).s('common.genericError')
    : 'Something went wrong.';

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // The interaction token expired (15 min) or was already consumed. Nothing
    // left to do — the original error is already logged.
  }
}
