import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { showPostModal } from '../../features/announcements/modal.js';
import type { Command } from '../../core/types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('devlog')
    .setDescription('Post a numbered devlog entry')
    .setDescriptionLocalizations({ 'es-ES': 'Publicar una entrada numerada de devlog' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addBooleanOption((option) =>
      option
        .setName('ping')
        .setDescription('Mention @everyone (use sparingly)')
        .setDescriptionLocalizations({ 'es-ES': 'Mencionar a @everyone (usar con criterio)' })
        .setRequired(false),
    ),

  async execute(interaction) {
    await showPostModal(interaction, 'devlog', interaction.options.getBoolean('ping') ?? false);
  },
};

export default command;
