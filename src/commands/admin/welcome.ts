import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { sendWelcome } from '../../features/welcome/index.js';
import { contextForUser } from '../../lib/context.js';
import type { Command } from '../../core/types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome card tools')
    .setDescriptionLocalizations({ 'es-ES': 'Herramientas de la tarjeta de bienvenida' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Preview the welcome card in this channel')
        .setDescriptionLocalizations({ 'es-ES': 'Previsualizar la tarjeta en este canal' })
        .addUserOption((option) =>
          option.setName('member').setDescription('Render the card for someone else'),
        ),
    ),

  async execute(interaction) {
    const { s } = contextForUser(interaction.guildId!, interaction.locale);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target =
      (interaction.options.getMember('member') as GuildMember | null) ?? (interaction.member as GuildMember);

    // Preview goes to the current channel so admins can iterate on the design
    // without spamming the real welcome channel.
    const sent = await sendWelcome(target, interaction.channel as GuildTextBasedChannel);

    await interaction.editReply(sent ? s('welcome.testSent') : s('common.genericError'));
  },
};

export default command;
