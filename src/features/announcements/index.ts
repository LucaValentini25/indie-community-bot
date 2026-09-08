import { type Guild, type User } from 'discord.js';
import { db, queryOneRequired } from '../../db/index.js';
import {
  brandedEmbed,
  contextFor,
  contextForUser,
  describeChannelFailure,
  localeRenderers,
  resolveSendableChannel,
} from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { isHttpUrl, truncate } from '../../lib/text.js';
import type { Locale } from '../../i18n/index.js';

const log = createLogger('posts');

export type PostKind = 'announcement' | 'devlog';

export interface LocalizedContent {
  title: string;
  body: string;
}

export interface PostInput {
  kind: PostKind;
  /**
   * The post text per language. A bilingual server supplies two entries, a
   * monolingual one supplies a single entry. Only languages configured as
   * public are rendered — the intersection of what was written and what the
   * server publishes in.
   */
  content: Partial<Record<Locale, LocalizedContent>>;
  imageUrl?: string | null;
  /** Mentions @everyone. Requires the author to have Mention Everyone. */
  ping?: boolean;
  author: User;
  /**
   * The author's Discord locale. Only used to render failure messages, which
   * only they see — the post itself always follows the server's languages.
   */
  viewerLocale?: string | null;
}

export type PostResult = { ok: true; channelId: string; messageId: string } | { ok: false; message: string };

/**
 * Publishes an announcement or devlog.
 *
 * A bilingual post is **one message with one embed per language**, not two
 * messages. That keeps it to a single ping, a single link to pin or share, and
 * a single row in the audit trail — and Discord renders stacked embeds with
 * clear separation, so the two languages never run together visually.
 */
export async function publishPost(guild: Guild, input: PostInput): Promise<PostResult> {
  const { config } = contextFor(guild.id);
  // Errors here are read by the author alone.
  const { s } = contextForUser(guild.id, input.viewerLocale);

  // Devlogs fall back to the announcements channel when no dedicated one is
  // set, so a fresh server works after configuring a single channel.
  const channelId =
    input.kind === 'devlog' ? (config.devlogChannelId ?? config.announceChannelId) : config.announceChannelId;

  const lookup = await resolveSendableChannel(guild, channelId);
  if (!lookup.ok) return { ok: false, message: describeChannelFailure(lookup, s) };

  const renderers = localeRenderers(config).filter((renderer) => input.content[renderer.locale]);

  if (renderers.length === 0) return { ok: false, message: s('announce.noContent') };

  // One number for the post, not one per language: a bilingual devlog is one
  // devlog.
  const number = input.kind === 'devlog' ? nextPostNumber(guild.id, 'devlog') : 0;

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

    // The language heading only earns its place when there is more than one.
    if (renderers.length > 1) embed.setAuthor({ name: renderer.label });

    // Timestamp, image and footer go on the last embed only, so the message
    // reads as one post rather than two stacked copies of the same metadata.
    if (isLast) {
      embed.setTimestamp(new Date()).setFooter({
        text: `${renderer.s(
          input.kind === 'devlog' ? 'announce.devlogFooter' : 'announce.announcementFooter',
        )}${config.gameName ? ` · ${config.gameName}` : ''}`,
        iconURL: input.author.displayAvatarURL({ extension: 'png', size: 64 }),
      });

      if (input.imageUrl && isHttpUrl(input.imageUrl)) embed.setImage(input.imageUrl);
    }

    return embed;
  });

  const message = await lookup.channel.send({
    content: input.ping ? '@everyone' : undefined,
    embeds,
    // Without this, any @mention typed into the body would fire. The ping is
    // opt-in and explicit.
    allowedMentions: input.ping ? { parse: ['everyone'] } : { parse: [] },
  });

  // The audit row stores the primary-language title. It exists to answer "what
  // did we post and when", not to be a second copy of the content.
  const primaryTitle = input.content[config.locale]?.title ?? input.content[renderers[0]!.locale]!.title;

  db.prepare(
    `INSERT INTO posts (guild_id, kind, author_id, channel_id, message_id, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    guild.id,
    input.kind,
    input.author.id,
    lookup.channel.id,
    message.id,
    truncate(primaryTitle, 200),
    Date.now(),
  );

  log.info(
    {
      guild: guild.id,
      kind: input.kind,
      message: message.id,
      locales: renderers.map((renderer) => renderer.locale),
    },
    'post published',
  );

  return { ok: true, channelId: lookup.channel.id, messageId: message.id };
}

function nextPostNumber(guildId: string, kind: PostKind): number {
  const row = queryOneRequired<{ count: number }>(
    'SELECT COUNT(*) AS count FROM posts WHERE guild_id = ? AND kind = ?',
    guildId,
    kind,
  );
  return row.count + 1;
}
