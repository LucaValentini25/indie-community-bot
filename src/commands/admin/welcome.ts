import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { sendWelcome } from '../../features/welcome/index.js';
import { cacheBackground, clearBackground, type BackgroundError } from '../../features/welcome/background.js';
import { updateGuildConfig } from '../../config/guild.js';
import { contextForUser } from '../../lib/context.js';
import type { Command } from '../../core/types.js';
import type { Translate } from '../../i18n/index.js';

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
    )
    .addSubcommand((sub) =>
      sub
        .setName('background')
        .setDescription('Set the artwork behind the welcome card, for this server')
        .setDescriptionLocalizations({ 'es-ES': 'Definir el arte de fondo de la tarjeta, en este servidor' })
        .addStringOption((option) =>
          option
            .setName('url')
            .setDescription('Direct link to an image, 1000x350 or wider')
            .setDescriptionLocalizations({ 'es-ES': 'Link directo a una imagen, 1000x350 o más ancha' }),
        )
        .addAttachmentOption((option) =>
          option
            .setName('file')
            .setDescription('Upload the image instead of linking it')
            .setDescriptionLocalizations({ 'es-ES': 'Subir la imagen en vez de enlazarla' }),
        )
        .addBooleanOption((option) =>
          option
            .setName('clear')
            .setDescription('Remove it and go back to the default artwork')
            .setDescriptionLocalizations({ 'es-ES': 'Quitarla y volver al arte por defecto' }),
        ),
    ),

  async execute(interaction) {
    const { s } = contextForUser(interaction.guildId!, interaction.locale);

    if (interaction.options.getSubcommand() === 'background') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await setBackground(interaction, s);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target =
      (interaction.options.getMember('member') as GuildMember | null) ?? (interaction.member as GuildMember);

    // Preview goes to the current channel so admins can iterate on the design
    // without spamming the real welcome channel.
    const sent = await sendWelcome(target, interaction.channel as GuildTextBasedChannel);

    await interaction.editReply(sent ? s('welcome.testSent') : s('common.genericError'));
  },
};

/**
 * Only the URL is stored; `cacheBackground` writes the bytes to the data
 * volume. See features/welcome/background.ts for why it is both and not either.
 */
async function setBackground(interaction: ChatInputCommandInteraction, s: Translate): Promise<void> {
  const guildId = interaction.guildId!;

  if (interaction.options.getBoolean('clear')) {
    clearBackground(guildId);
    updateGuildConfig(guildId, { welcomeBackgroundUrl: null });
    await interaction.editReply(s('welcome.backgroundCleared'));
    return;
  }

  const url = interaction.options.getString('url') ?? interaction.options.getAttachment('file')?.url;

  if (!url) {
    await interaction.editReply(s('welcome.backgroundNothing'));
    return;
  }

  const result = await cacheBackground(guildId, url);

  if (!result.ok) {
    await interaction.editReply(describeBackgroundError(result.reason, s));
    return;
  }

  updateGuildConfig(guildId, { welcomeBackgroundUrl: url });

  await interaction.editReply(
    `✅ ${s('welcome.backgroundSet')}
${s('welcome.backgroundPreviewHint')}`,
  );
}

function describeBackgroundError(reason: BackgroundError, s: Translate): string {
  switch (reason) {
    case 'not-a-url':
      return s('welcome.backgroundNotUrl');
    case 'unreachable':
      return s('welcome.backgroundUnreachable');
    case 'not-an-image':
      return s('welcome.backgroundNotImage');
    case 'too-big':
      return s('welcome.backgroundTooBig');
    case 'undecodable':
      return s('welcome.backgroundUndecodable');
  }
}

export default command;
