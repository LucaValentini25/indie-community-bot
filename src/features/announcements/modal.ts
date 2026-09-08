import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { contextFor } from '../../lib/context.js';
import { truncate } from '../../lib/text.js';
import { publishPost, type PostKind } from './index.js';

/**
 * A modal — not command options — because announcements are multi-paragraph
 * text with line breaks, which the slash-command option box handles badly.
 *
 * The kind and the ping flag are chosen in the command, then carried through
 * the modal's custom ID: `post:modal:<kind>:<ping>`. Encoding them in the ID
 * means we hold no server-side state between the command and the submit.
 */
const PREFIX = 'post:modal';

export function modalId(kind: PostKind, ping: boolean): string {
  return `${PREFIX}:${kind}:${ping ? '1' : '0'}`;
}

export function isPostModal(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

export async function showPostModal(
  interaction: ChatInputCommandInteraction,
  kind: PostKind,
  ping: boolean,
): Promise<void> {
  const { s } = contextFor(interaction.guildId!);

  const modal = new ModalBuilder()
    .setCustomId(modalId(kind, ping))
    .setTitle(truncate(s(kind === 'devlog' ? 'announce.devlogFooter' : 'announce.announcementFooter'), 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(truncate(s('announce.modalTitleLabel'), 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(200)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('body')
          .setLabel(truncate(s('announce.modalBodyLabel'), 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('image')
          .setLabel(truncate(s('announce.modalImageLabel'), 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(500)
          .setRequired(false),
      ),
    );

  await interaction.showModal(modal);
}

export async function handlePostModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;

  const [, , kind, ping] = interaction.customId.split(':');
  const { s } = contextFor(interaction.guild.id);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await publishPost(interaction.guild, {
    kind: kind === 'devlog' ? 'devlog' : 'announcement',
    title: interaction.fields.getTextInputValue('title').trim(),
    body: interaction.fields.getTextInputValue('body').trim(),
    imageUrl: interaction.fields.getTextInputValue('image')?.trim() || null,
    ping: ping === '1',
    author: interaction.user,
  });

  await interaction.editReply({
    content: result.ok ? s('announce.posted', { channel: `<#${result.channelId}>` }) : result.message,
  });
}
