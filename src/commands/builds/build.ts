import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { announceBuild, latestBuild, recentBuilds } from '../../features/builds/index.js';
import { brandedEmbed, contextFor } from '../../lib/context.js';
import { absoluteTime, truncate } from '../../lib/text.js';
import type { Command } from '../../core/types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription('Announce and review game builds')
    .setDescriptionLocalizations({ 'es-ES': 'Anunciar y consultar builds del juego' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('announce')
        .setDescription('Announce a new build manually')
        .setDescriptionLocalizations({ 'es-ES': 'Anunciar una nueva build manualmente' })
        .addStringOption((option) =>
          option.setName('version').setDescription('Version, e.g. 0.4.2').setRequired(true).setMaxLength(60),
        )
        .addStringOption((option) =>
          option
            .setName('channel')
            .setDescription('Release channel / Steam branch')
            .setRequired(false)
            .addChoices(
              { name: 'stable', value: 'stable' },
              { name: 'beta', value: 'beta' },
              { name: 'playtest', value: 'playtest' },
              { name: 'nightly', value: 'nightly' },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('notes')
            .setDescription('Changelog. Use \\n for line breaks.')
            .setRequired(false)
            .setMaxLength(3800),
        )
        .addStringOption((option) =>
          option.setName('platforms').setDescription('e.g. Windows, Linux, Steam Deck').setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('url').setDescription('Link to the release or store page').setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('force').setDescription('Announce even if this version was already posted'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('latest')
        .setDescription('Show the most recently announced build')
        .setDescriptionLocalizations({ 'es-ES': 'Ver la última build anunciada' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List recent builds')
        .setDescriptionLocalizations({ 'es-ES': 'Listar las builds recientes' }),
    ),

  async execute(interaction) {
    const guildId = interaction.guildId!;
    const { config, s } = contextFor(guildId);

    switch (interaction.options.getSubcommand()) {
      case 'announce': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const version = interaction.options.getString('version', true).trim();
        const channel = interaction.options.getString('channel') ?? 'stable';

        const result = await announceBuild(interaction.client, {
          guildId,
          version,
          channel,
          // Discord options cannot contain real newlines; let authors type \n.
          notes: interaction.options.getString('notes')?.replaceAll('\\n', '\n') ?? null,
          platforms: interaction.options.getString('platforms'),
          url: interaction.options.getString('url'),
          source: 'manual',
          force: interaction.options.getBoolean('force') ?? false,
        });

        if (result.ok) {
          await interaction.editReply(s('build.posted', { version, channel: `<#${result.channelId}>` }));
        } else if (result.reason === 'duplicate') {
          await interaction.editReply(s('build.duplicate', { version, channel }));
        } else if (result.reason === 'channel') {
          await interaction.editReply(result.message);
        } else {
          await interaction.editReply(s('common.genericError'));
        }
        return;
      }

      case 'latest': {
        const build = latestBuild(guildId);
        if (!build) {
          await interaction.reply({ content: s('build.noBuilds'), flags: MessageFlags.Ephemeral });
          return;
        }

        const embed = brandedEmbed(config)
          .setTitle(s('build.latestTitle'))
          .addFields(
            { name: s('build.fieldVersion'), value: `\`${build.version}\``, inline: true },
            { name: s('build.fieldChannel'), value: `\`${build.channel}\``, inline: true },
          )
          .setTimestamp(new Date(build.created_at));

        if (build.platforms) {
          embed.addFields({ name: s('build.fieldPlatforms'), value: build.platforms, inline: true });
        }
        if (build.notes) embed.setDescription(truncate(build.notes, 2000));
        if (build.url) embed.setURL(build.url);

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      case 'list': {
        const builds = recentBuilds(guildId, 10);
        if (builds.length === 0) {
          await interaction.reply({ content: s('build.noBuilds'), flags: MessageFlags.Ephemeral });
          return;
        }

        const embed = brandedEmbed(config)
          .setTitle(s('build.listTitle'))
          .setDescription(
            builds
              .map(
                (build) =>
                  `**\`${build.version}\`** · \`${build.channel}\` · ${absoluteTime(build.created_at)}`,
              )
              .join('\n'),
          );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    }
  },
};

export default command;
