import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { contextForUser, publicLocales } from '../../lib/context.js';
import { getGuildConfig } from '../../config/guild.js';
import { isLocale, LOCALE_LABELS, type Locale } from '../../i18n/index.js';
import { truncate } from '../../lib/text.js';
import { publishPost, type LocalizedContent, type PostKind } from './index.js';

/**
 * A modal — not command options — because announcements are multi-paragraph
 * text with line breaks, which the slash-command option box handles badly.
 *
 * The kind, the ping flag and the languages to ask for are chosen in the
 * command and carried through the modal's custom ID:
 *
 *   post:modal:<kind>:<ping>:<locale,locale>
 *
 * Encoding them there means we hold no server-side state between the command
 * and the submit, which matters because a user can leave a modal open for
 * minutes and submit after a restart.
 */
const PREFIX = 'post:modal';

/**
 * Discord allows at most 5 components in a modal. Two languages need four
 * fields plus the image URL, which is exactly the ceiling — so a third public
 * language would not fit and is capped here rather than failing at submit.
 */
const MAX_LOCALES_PER_MODAL = 2;

export function isPostModal(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

function fieldId(kind: 'title' | 'body', locale: Locale): string {
  return `${kind}_${locale}`;
}

export async function showPostModal(
  interaction: ChatInputCommandInteraction,
  kind: PostKind,
  ping: boolean,
  only: Locale | null,
): Promise<void> {
  const guildId = interaction.guildId!;
  const config = getGuildConfig(guildId);
  // Static labels follow the author's own language; the per-field marker says
  // which language the text they type should be in.
  const { s } = contextForUser(guildId, interaction.locale);

  const locales = (only ? [only] : publicLocales(config)).slice(0, MAX_LOCALES_PER_MODAL);
  const bilingual = locales.length > 1;

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:${kind}:${ping ? '1' : '0'}:${locales.join(',')}`)
    .setTitle(truncate(s(kind === 'devlog' ? 'announce.devlogFooter' : 'announce.announcementFooter'), 45));

  for (const locale of locales) {
    // Only mark the language when there is a choice to be made.
    const marker = bilingual ? ` · ${LOCALE_LABELS[locale]}` : '';

    modal.addComponents(
      row(
        new TextInputBuilder()
          .setCustomId(fieldId('title', locale))
          .setLabel(truncate(`${s('announce.modalTitleLabel')}${marker}`, 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(200)
          .setRequired(true),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(fieldId('body', locale))
          .setLabel(truncate(`${s('announce.modalBodyLabel')}${marker}`, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true),
      ),
    );
  }

  modal.addComponents(
    row(
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

function row(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

export async function handlePostModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;

  const [, , kind, ping, localeList] = interaction.customId.split(':');
  const { s } = contextForUser(interaction.guild.id, interaction.locale);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const locales = (localeList ?? '').split(',').filter(isLocale);
  const content: Partial<Record<Locale, LocalizedContent>> = {};

  for (const locale of locales) {
    content[locale] = {
      title: interaction.fields.getTextInputValue(fieldId('title', locale)).trim(),
      body: interaction.fields.getTextInputValue(fieldId('body', locale)).trim(),
    };
  }

  const result = await publishPost(interaction.guild, {
    kind: kind === 'devlog' ? 'devlog' : 'announcement',
    content,
    imageUrl: interaction.fields.getTextInputValue('image')?.trim() || null,
    ping: ping === '1',
    author: interaction.user,
    viewerLocale: interaction.locale,
  });

  await interaction.editReply({
    content: result.ok ? s('announce.posted', { channel: `<#${result.channelId}>` }) : result.message,
  });
}
