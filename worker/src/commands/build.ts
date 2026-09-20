import {
  announceBuild,
  latestBuild,
  notesForLocale,
  recentBuilds,
  type LocalizedNotes,
} from '../features/builds.js';
import { brandedEmbed, contextForUser } from '../lib/context.js';
import { absoluteTime, truncate } from '../../../src/lib/text.js';
import { EPHEMERAL } from '../discord/message.js';
import type { Interaction } from '../discord/interaction.js';
import type { WorkerCommand } from './types.js';

/** Discord option values cannot carry real newlines; authors type a literal \n. */
function unescapeNewlines(value: string | null): string | null {
  return value?.replaceAll('\\n', '\n') ?? null;
}

function notesByLocale(ix: Interaction): LocalizedNotes {
  const notes: LocalizedNotes = {};
  const en = unescapeNewlines(ix.options.getString('notes_en'));
  const es = unescapeNewlines(ix.options.getString('notes_es'));
  if (en) notes.en = en;
  if (es) notes.es = es;
  return notes;
}

export const build: WorkerCommand = {
  async execute(app, ix) {
    const guildId = ix.guildId!;
    // Every reply here is ephemeral, so it renders in the viewer's own language.
    const { config, s, locale } = await contextForUser(app, guildId, ix.locale);

    switch (ix.options.subcommand) {
      case 'announce': {
        await ix.deferReply({ flags: EPHEMERAL });

        const version = ix.options.getString('version', true).trim();
        const channel = ix.options.getString('channel') ?? 'stable';

        const result = await announceBuild(app, {
          guildId,
          version,
          channel,
          notes: unescapeNewlines(ix.options.getString('notes')),
          notesByLocale: notesByLocale(ix),
          platforms: ix.options.getString('platforms'),
          url: ix.options.getString('url'),
          source: 'manual',
          viewerLocale: ix.locale,
          force: ix.options.getBoolean('force') ?? false,
        });

        if (result.ok) {
          await ix.editReply(s('build.posted', { version, channel: `<#${result.channelId}>` }));
        } else if (result.reason === 'duplicate') {
          await ix.editReply(s('build.duplicate', { version, channel }));
        } else if (result.reason === 'channel') {
          await ix.editReply(result.message);
        } else {
          await ix.editReply(s('common.genericError'));
        }
        return;
      }

      case 'latest': {
        const latest = await latestBuild(app, guildId);
        if (!latest) {
          await ix.reply({ content: s('build.noBuilds'), flags: EPHEMERAL });
          return;
        }

        const embed = brandedEmbed(config)
          .setTitle(s('build.latestTitle'))
          .addFields(
            { name: s('build.fieldVersion'), value: `\`${latest.version}\``, inline: true },
            { name: s('build.fieldChannel'), value: `\`${latest.channel}\``, inline: true },
          )
          .setTimestamp(new Date(latest.created_at));

        if (latest.platforms) {
          embed.addFields({ name: s('build.fieldPlatforms'), value: latest.platforms, inline: true });
        }
        const notes = notesForLocale(latest, locale);
        if (notes) embed.setDescription(truncate(notes, 2000));
        if (latest.url) embed.setURL(latest.url);

        await ix.reply({ embeds: [embed], flags: EPHEMERAL });
        return;
      }

      case 'list': {
        const builds = await recentBuilds(app, guildId, 10);
        if (builds.length === 0) {
          await ix.reply({ content: s('build.noBuilds'), flags: EPHEMERAL });
          return;
        }

        const embed = brandedEmbed(config)
          .setTitle(s('build.listTitle'))
          .setDescription(
            builds
              .map((row) => `**\`${row.version}\`** · \`${row.channel}\` · ${absoluteTime(row.created_at)}`)
              .join('\n'),
          );

        await ix.reply({ embeds: [embed], flags: EPHEMERAL });
        return;
      }
    }
  },
};
