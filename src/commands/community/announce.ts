import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { showPostModal } from '../../features/announcements/modal.js';
import { isLocale } from '../../i18n/index.js';
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
    )
    .addStringOption((option) =>
      option
        .setName('language')
        .setDescription('Post in one language only (default: every language the server publishes in)')
        .setDescriptionLocalizations({
          'es-ES': 'Publicar en un solo idioma (por defecto: todos los del servidor)',
        })
        .setRequired(false)
        .addChoices({ name: 'English', value: 'en' }, { name: 'Español', value: 'es' }),
    ),

  async execute(interaction) {
    const only = interaction.options.getString('language');
    await showPostModal(
      interaction,
      'announcement',
      interaction.options.getBoolean('ping') ?? false,
      only && isLocale(only) ? only : null,
    );
  },
};

export default command;
