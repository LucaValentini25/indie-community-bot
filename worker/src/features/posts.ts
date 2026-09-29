import { ActionRowBuilder, ModalBuilder, TextInputBuilder } from '@discordjs/builders';
import { TextInputStyle, type APIUser } from 'discord-api-types/v10';
import {
  brandedEmbed,
  contextFor,
  contextForUser,
  describeChannelFailure,
  publicLocales,
  resolvePublicationTargets,
} from '../lib/context.js';
import { getGuildConfig } from '../config/guild.js';
import { avatarUrl } from '../lib/discord.js';
import { createLogger } from '../logger.js';
import { isHttpUrl, truncate } from '../../../src/lib/text.js';
import { isLocale, LOCALE_LABELS, type Locale } from '../../../src/i18n/index.js';
import type { Interaction } from '../discord/interaction.js';
import { EPHEMERAL } from '../discord/message.js';
import type { App } from '../types.js';

const log = createLogger('posts');

export type PostKind = 'announcement' | 'devlog';

export interface LocalizedContent {
  title: string;
  body: string;
}

export interface PostInput {
  kind: PostKind;
  /** The text per language; only languages the server publishes in are rendered. */
  content: Partial<Record<Locale, LocalizedContent>>;
  imageUrl?: string | null;
  /** Mentions @everyone. Discord only lets the command through for members who may. */
  ping?: boolean;
  author: APIUser;
  /** The author's Discord locale. Only used for failure messages only they see. */
  viewerLocale?: string | null;
}

export type PostResult = { ok: true; channelId: string; messageId: string } | { ok: false; message: string };

/**
 * Publishes an announcement or devlog.
 *
 * A bilingual post is **one message with one embed per language**, not two.
 * That keeps it to a single ping and a single link to pin or share.
 */
export async function publishPost(app: App, guildId: string, input: PostInput): Promise<PostResult> {
  const { config } = await contextFor(app, guildId);
  // Errors here are read by the author alone.
  const { s } = await contextForUser(app, guildId, input.viewerLocale);

  // Devlogs fall back to the announcements channel when no dedicated one is set.
  const channelId =
    input.kind === 'devlog' ? (config.devlogChannelId ?? config.announceChannelId) : config.announceChannelId;
  const secondaryChannelId =
    input.kind === 'devlog'
      ? (config.devlogChannelSecondaryId ?? config.announceChannelSecondaryId)
      : config.announceChannelSecondaryId;

  const resolved = await resolvePublicationTargets(app, guildId, config, channelId, secondaryChannelId);
  if (!resolved.ok) return { ok: false, message: describeChannelFailure(resolved.failure, s) };

  // Drop languages with no text, and then any target left carrying none.
  const targets = resolved.targets
    .map((target) => ({
      ...target,
      renderers: target.renderers.filter((renderer) => input.content[renderer.locale]),
    }))
    .filter((target) => target.renderers.length > 0);

  if (targets.length === 0) return { ok: false, message: s('announce.noContent') };

  // One number for the post, not one per language.
  const number = input.kind === 'devlog' ? await nextPostNumber(app, guildId, 'devlog') : 0;

  const sent: { channelId: string; messageId: string }[] = [];

  for (const target of targets) {
    const renderers = target.renderers;
    const embeds = renderers.map((renderer, index) => {
      const content = input.content[renderer.locale]!;
      const isLast = index === renderers.length - 1;

      const embed = brandedEmbed(config)
        .setTitle(
          truncate(
            input.kind === 'devlog'
              ? renderer.s('announce.devlogTitle', { number, title: content.title })
              : content.title,
            256,
          ),
        )
        .setDescription(truncate(content.body, 4000));

      if (renderers.length > 1) embed.setAuthor({ name: renderer.label });

      // Timestamp, image and footer go on the last embed only, so the message
      // reads as one post rather than two stacked copies of the same metadata.
      if (isLast) {
        embed.setTimestamp(new Date()).setFooter({
          text: `${renderer.s(
            input.kind === 'devlog' ? 'announce.devlogFooter' : 'announce.announcementFooter',
          )}${config.gameName ? ` · ${config.gameName}` : ''}`,
          iconURL: avatarUrl(input.author),
        });

        if (input.imageUrl && isHttpUrl(input.imageUrl)) embed.setImage(input.imageUrl);
      }

      return embed;
    });

    const message = await app.rest.createMessage(target.channel.id, {
      content: input.ping ? '@everyone' : undefined,
      embeds: embeds.map((embed) => embed.toJSON()),
      // Without this, any @mention typed into the body would fire.
      allowed_mentions: input.ping ? { parse: ['everyone'] } : { parse: [] },
    });

    sent.push({ channelId: target.channel.id, messageId: message.id });
  }

  // The audit row stores the primary-language title: it answers "what did we
  // post and when", it is not a second copy of the content.
  const primaryTitle =
    input.content[config.locale]?.title ?? input.content[targets[0]!.renderers[0]!.locale]!.title;

  for (const row of sent) {
    await app.db.run(
      `INSERT INTO posts (guild_id, kind, author_id, channel_id, message_id, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      guildId,
      input.kind,
      input.author.id,
      row.channelId,
      row.messageId,
      truncate(primaryTitle, 200),
      Date.now(),
    );
  }

  log.info(
    { guild: guildId, kind: input.kind, messages: sent.map((row) => row.messageId) },
    'post published',
  );

  return { ok: true, channelId: sent[0]!.channelId, messageId: sent[0]!.messageId };
}

async function nextPostNumber(app: App, guildId: string, kind: PostKind): Promise<number> {
  const row = await app.db.firstRequired<{ count: number }>(
    'SELECT COUNT(*) AS count FROM posts WHERE guild_id = ? AND kind = ?',
    guildId,
    kind,
  );
  return row.count + 1;
}

// ─────────────────────────────────────────────────────────────
//  The modal
// ─────────────────────────────────────────────────────────────

/**
 * A modal — not command options — because announcements are multi-paragraph
 * text, which the slash-command option box handles badly.
 *
 * The kind, the ping flag and the languages are carried in the custom ID:
 *
 *   post:modal:<kind>:<ping>:<locale,locale>
 *
 * so nothing is held between the command and the submit. That matters even
 * more here than on a server: there is no process to hold it in.
 */
const PREFIX = 'post:modal';

/** Five components per modal: two languages need four fields plus the image. */
const MAX_LOCALES_PER_MODAL = 2;

export function isPostModal(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

function fieldId(kind: 'title' | 'body', locale: Locale): string {
  return `${kind}_${locale}`;
}

function row(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

export async function showPostModal(
  app: App,
  ix: Interaction,
  kind: PostKind,
  ping: boolean,
  only: Locale | null,
): Promise<void> {
  const guildId = ix.guildId!;
  const config = await getGuildConfig(app, guildId);
  const { s } = await contextForUser(app, guildId, ix.locale);

  const locales = (only ? [only] : publicLocales(config)).slice(0, MAX_LOCALES_PER_MODAL);
  const bilingual = locales.length > 1;

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:${kind}:${ping ? '1' : '0'}:${locales.join(',')}`)
    .setTitle(truncate(s(kind === 'devlog' ? 'announce.devlogFooter' : 'announce.announcementFooter'), 45));

  for (const locale of locales) {
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

  await ix.showModal(modal);
}

export async function handlePostModal(app: App, ix: Interaction): Promise<void> {
  const guildId = ix.guildId;
  if (!guildId) return;

  const [, , kind, ping, localeList] = ix.customId.split(':');
  const { s } = await contextForUser(app, guildId, ix.locale);

  // Publishing means several API calls, which can outrun the 3-second window.
  await ix.deferReply({ flags: EPHEMERAL });

  const locales = (localeList ?? '').split(',').filter(isLocale);
  const content: Partial<Record<Locale, LocalizedContent>> = {};

  for (const locale of locales) {
    content[locale] = {
      title: ix.fields.getText(fieldId('title', locale)).trim(),
      body: ix.fields.getText(fieldId('body', locale)).trim(),
    };
  }

  const result = await publishPost(app, guildId, {
    kind: kind === 'devlog' ? 'devlog' : 'announcement',
    content,
    imageUrl: ix.fields.getText('image').trim() || null,
    ping: ping === '1',
    author: ix.user,
    viewerLocale: ix.locale,
  });

  await ix.editReply({
    content: result.ok ? s('announce.posted', { channel: `<#${result.channelId}>` }) : result.message,
  });
}
