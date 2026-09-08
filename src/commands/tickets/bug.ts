import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildPanel, isStaff } from '../../features/tickets/index.js';
import { openTickets, ticketStats } from '../../features/tickets/repository.js';
import {
  brandedEmbed,
  contextFor,
  describeChannelFailure,
  resolveSendableChannel,
} from '../../lib/context.js';
import { truncate } from '../../lib/text.js';
import type { Command } from '../../core/types.js';
import type { GuildMember } from 'discord.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bug')
    .setDescription('Bug report tools')
    .setDescriptionLocalizations({ 'es-ES': 'Herramientas de reportes de bugs' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Post the "Report a bug" panel in the configured channel')
        .setDescriptionLocalizations({ 'es-ES': 'Publicar el panel de reportes en el canal configurado' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List open bug reports')
        .setDescriptionLocalizations({ 'es-ES': 'Listar los reportes abiertos' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('Show report counts by status')
        .setDescriptionLocalizations({ 'es-ES': 'Ver la cantidad de reportes por estado' }),
    ),

  async execute(interaction) {
    const guildId = interaction.guildId!;
    const { config, s } = contextFor(guildId);

    switch (interaction.options.getSubcommand()) {
      case 'panel': {
        if (!isStaff(interaction.member as GuildMember | null, config)) {
          await interaction.reply({
            content: s('common.missingPermission'),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const lookup = await resolveSendableChannel(interaction.guild!, config.ticketChannelId);
        if (!lookup.ok) {
          await interaction.editReply(describeChannelFailure(lookup, s));
          return;
        }

        await lookup.channel.send(buildPanel(config, s));
        await interaction.editReply(s('ticket.panelPosted', { channel: `<#${lookup.channel.id}>` }));
        return;
      }

      case 'list': {
        const tickets = openTickets(guildId);
        const embed = brandedEmbed(config).setTitle(s('ticket.listTitle'));

        embed.setDescription(
          tickets.length === 0
            ? s('ticket.listEmpty')
            : truncate(
                tickets
                  .map((ticket) =>
                    s('ticket.listEntry', {
                      number: ticket.number,
                      summary: truncate(ticket.title, 70),
                      thread: ticket.thread_id,
                    }),
                  )
                  .join('\n'),
                4000,
              ),
        );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      case 'stats': {
        const stats = ticketStats(guildId);
        const embed = brandedEmbed(config)
          .setTitle(s('ticket.listTitle'))
          .addFields(
            { name: s('ticket.statusOpen'), value: String(stats.open), inline: true },
            { name: s('ticket.statusClaimed'), value: String(stats.claimed), inline: true },
            { name: s('ticket.statusClosed'), value: String(stats.closed), inline: true },
          );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    }
  },
};

export default command;
