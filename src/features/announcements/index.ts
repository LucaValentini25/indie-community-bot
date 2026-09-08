import { type Guild, type User } from 'discord.js';
import { db, queryOneRequired } from '../../db/index.js';
import {
  brandedEmbed,
  contextFor,
  describeChannelFailure,
  resolveSendableChannel,
} from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { isHttpUrl, truncate } from '../../lib/text.js';

const log = createLogger('posts');

export type PostKind = 'announcement' | 'devlog';

export interface PostInput {
  kind: PostKind;
  title: string;
  body: string;
  imageUrl?: string | null;
  /** Mentions @everyone. Requires the author to have Mention Everyone. */
  ping?: boolean;
  author: User;
}

export type PostResult = { ok: true; channelId: string; messageId: string } | { ok: false; message: string };

export async function publishPost(guild: Guild, input: PostInput): Promise<PostResult> {
  const { config, s } = contextFor(guild.id);

  // Devlogs fall back to the announcements channel when no dedicated one is set,
  // so a fresh server works after configuring a single channel.
  const channelId =
    input.kind === 'devlog' ? (config.devlogChannelId ?? config.announceChannelId) : config.announceChannelId;

  const lookup = await resolveSendableChannel(guild, channelId);
  if (!lookup.ok) return { ok: false, message: describeChannelFailure(lookup, s) };

  const number = input.kind === 'devlog' ? nextPostNumber(guild.id, 'devlog') : 0;

  const embed = brandedEmbed(config)
    .setTitle(
      truncate(
        input.kind === 'devlog' ? s('announce.devlogTitle', { number, title: input.title }) : input.title,
        256,
      ),
    )
    .setDescription(truncate(input.body, 4000))
    .setTimestamp(new Date())
    .setFooter({
      text: `${s(input.kind === 'devlog' ? 'announce.devlogFooter' : 'announce.announcementFooter')}${
        config.gameName ? ` · ${config.gameName}` : ''
      }`,
      iconURL: input.author.displayAvatarURL({ extension: 'png', size: 64 }),
    });

  if (input.imageUrl && isHttpUrl(input.imageUrl)) embed.setImage(input.imageUrl);

  const message = await lookup.channel.send({
    content: input.ping ? '@everyone' : undefined,
    embeds: [embed],
    // Without this, any @mention typed into the body would fire. The ping is
    // opt-in and explicit.
    allowedMentions: input.ping ? { parse: ['everyone'] } : { parse: [] },
  });

  db.prepare(
    `INSERT INTO posts (guild_id, kind, author_id, channel_id, message_id, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(guild.id, input.kind, input.author.id, lookup.channel.id, message.id, input.title, Date.now());

  log.info({ guild: guild.id, kind: input.kind, message: message.id }, 'post published');

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
