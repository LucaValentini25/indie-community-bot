import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { showPostModal } from '../../features/announcements/modal.js';
import type { Command } from '../../core/types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement to the community')
    .setDescriptionLocalizations({ 'es-ES': 'Publicar un anuncio para la comunidad' })
    .setContexts(InteractionContextType.Guild)
    // Visible only to members who can manage messages; server owners can widen
    // this per-command in Server Settings → Integrations.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addBooleanOption((option) =>
      option
        .setName('ping')
        .setDescription('Mention @everyone (use sparingly)')
        .setDescriptionLocalizations({ 'es-ES': 'Mencionar a @everyone (usar con criterio)' })
        .setRequired(false),
    ),

  async execute(interaction) {
    await showPostModal(interaction, 'announcement', interaction.options.getBoolean('ping') ?? false);
  },
};

export default command;
