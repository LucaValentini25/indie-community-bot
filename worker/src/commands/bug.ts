import { buildPanel, isStaff, openTickets, ticketStats } from '../features/tickets.js';
import {
  brandedEmbed,
  contextForUser,
  describeChannelFailure,
  resolveSendableChannel,
} from '../lib/context.js';
import { truncate } from '../../../src/lib/text.js';
import { EPHEMERAL } from '../discord/message.js';
import type { WorkerCommand } from './types.js';

export const bug: WorkerCommand = {
  async execute(app, ix) {
    const guildId = ix.guildId!;
    // All three subcommands reply ephemerally, so they use the viewer's language.
    const { config, s } = await contextForUser(app, guildId, ix.locale);

    switch (ix.options.subcommand) {
      case 'panel': {
        if (!isStaff(ix.member, config)) {
          await ix.reply({ content: s('common.missingPermission'), flags: EPHEMERAL });
          return;
        }

        await ix.deferReply({ flags: EPHEMERAL });

        const lookup = await resolveSendableChannel(app, guildId, config.ticketChannelId);
        if (!lookup.ok) {
          await ix.editReply(describeChannelFailure(lookup, s));
          return;
        }

        const panel = buildPanel(config);
        await app.rest.createMessage(lookup.channel.id, {
          embeds: panel.embeds.map((embed) => embed.toJSON()),
          components: panel.components.map((row) => row.toJSON()),
        });
        await ix.editReply(s('ticket.panelPosted', { channel: `<#${lookup.channel.id}>` }));
        return;
      }

      case 'list': {
        const tickets = await openTickets(app, guildId);
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

        await ix.reply({ embeds: [embed], flags: EPHEMERAL });
        return;
      }

      case 'stats': {
        const stats = await ticketStats(app, guildId);
        const embed = brandedEmbed(config)
          .setTitle(s('ticket.listTitle'))
          .addFields(
            { name: s('ticket.statusOpen'), value: String(stats.open), inline: true },
            { name: s('ticket.statusClaimed'), value: String(stats.claimed), inline: true },
            { name: s('ticket.statusClosed'), value: String(stats.closed), inline: true },
          );

        await ix.reply({ embeds: [embed], flags: EPHEMERAL });
        return;
      }
    }
  },
};
