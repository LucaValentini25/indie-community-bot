import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import {
  contextFor,
  brandedEmbed,
  describeChannelFailure,
  resolveSendableChannel,
} from '../../lib/context.js';
import { nextTicketNumber, type GuildConfig } from '../../config/guild.js';
import { createLogger } from '../../core/logger.js';
import { slugify, truncate } from '../../lib/text.js';
import type { Translate, TranslationKey } from '../../i18n/index.js';
import {
  claimTicket,
  closeTicket,
  createTicket,
  reopenTicket,
  ticketById,
  TICKET_RESOLUTIONS,
  type Ticket,
  type TicketResolution,
} from './repository.js';

const log = createLogger('tickets');

/**
 * Custom IDs are the only state a Discord component carries between the click
 * and our handler, so they encode the ticket id. Everything else is re-read
 * from the database — never trust a component to carry authoritative data.
 */
export const TicketIds = {
  openButton: 'ticket:open',
  modal: 'ticket:modal',
  claim: (id: number) => `ticket:claim:${id}`,
  close: (id: number) => `ticket:close:${id}`,
  reopen: (id: number) => `ticket:reopen:${id}`,
  resolve: (id: number) => `ticket:resolve:${id}`,
} as const;

const Fields = {
  summary: 'summary',
  details: 'details',
  platform: 'platform',
  version: 'version',
} as const;

const STATUS_COLORS = { open: 0xe5a50a, claimed: 0x3b82f6, closed: 0x2f9e44 } as const;

const RESOLUTION_LABEL_KEYS: Record<TicketResolution, TranslationKey> = {
  fixed: 'ticket.resolutionFixed',
  duplicate: 'ticket.resolutionDuplicate',
  notABug: 'ticket.resolutionNotABug',
  wontFix: 'ticket.resolutionWontFix',
  noRepro: 'ticket.resolutionNoRepro',
};

const STATUS_LABEL_KEYS = {
  open: 'ticket.statusOpen',
  claimed: 'ticket.statusClaimed',
  closed: 'ticket.statusClosed',
} as const satisfies Record<Ticket['status'], TranslationKey>;

// ─────────────────────────────────────────────────────────────
//  Panel
// ─────────────────────────────────────────────────────────────

/** The always-on message with the "Report a bug" button. */
export function buildPanel(
  config: GuildConfig,
  s: Translate,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = brandedEmbed(config)
    .setTitle(s('ticket.panelTitle'))
    .setDescription(s('ticket.panelDescription'));

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(TicketIds.openButton)
      .setStyle(ButtonStyle.Primary)
      .setLabel(s('ticket.panelButton'))
      .setEmoji('🐛'),
  );

  return { embeds: [embed], components: [row] };
}

// ─────────────────────────────────────────────────────────────
//  Open flow
// ─────────────────────────────────────────────────────────────

export async function showReportModal(interaction: ButtonInteraction): Promise<void> {
  const { s } = contextFor(interaction.guildId!);

  const modal = new ModalBuilder().setCustomId(TicketIds.modal).setTitle(s('ticket.modalTitle'));

  modal.addComponents(
    row(
      new TextInputBuilder()
        .setCustomId(Fields.summary)
        .setLabel(truncate(s('ticket.modalSummaryLabel'), 45))
        .setPlaceholder(truncate(s('ticket.modalSummaryPlaceholder'), 100))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(120)
        .setRequired(true),
    ),
    row(
      new TextInputBuilder()
        .setCustomId(Fields.details)
        .setLabel(truncate(s('ticket.modalDetailsLabel'), 45))
        .setPlaceholder(truncate(s('ticket.modalDetailsPlaceholder'), 100))
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true),
    ),
    row(
      new TextInputBuilder()
        .setCustomId(Fields.platform)
        .setLabel(truncate(s('ticket.modalPlatformLabel'), 45))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(60)
        .setRequired(false),
    ),
    row(
      new TextInputBuilder()
        .setCustomId(Fields.version)
        .setLabel(truncate(s('ticket.modalVersionLabel'), 45))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(40)
        .setRequired(false),
    ),
  );

  await interaction.showModal(modal);
}

function row(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

export async function handleReportSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  const { config, s } = contextFor(interaction.guild.id);

  // Creating a thread and posting into it takes longer than the 3s interaction
  // window, so acknowledge first.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const summary = interaction.fields.getTextInputValue(Fields.summary).trim();
  const details = interaction.fields.getTextInputValue(Fields.details).trim();
  const platform = optional(interaction, Fields.platform);
  const version = optional(interaction, Fields.version);

  // The panel can be moved after posting, so post reports into the configured
  // channel, falling back to wherever the panel actually lives.
  const configured = await resolveSendableChannel(interaction.guild, config.ticketChannelId, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads,
  ]);

  if (!configured.ok) {
    await interaction.editReply({ content: describeChannelFailure(configured, s) });
    return;
  }

  const parent = configured.channel;
  if (parent.type !== ChannelType.GuildText) {
    await interaction.editReply({ content: s('common.channelUnavailable') });
    return;
  }

  const number = nextTicketNumber(interaction.guild.id);

  try {
    const thread = await parent.threads.create({
      name: truncate(s('ticket.threadName', { number, summary: slugify(summary, 40) }), 100),
      type: ChannelType.PrivateThread,
      // Keep the thread visible only to people explicitly added plus staff.
      invitable: false,
      autoArchiveDuration: 10080, // 7 days
      reason: `Bug report #${number} by ${interaction.user.tag}`,
    });

    const ticket = createTicket({
      guildId: interaction.guild.id,
      number,
      threadId: thread.id,
      openerId: interaction.user.id,
      category: 'bug',
      title: summary,
      body: details,
      platform,
      buildVersion: version,
    });

    await thread.members.add(interaction.user.id).catch(() => null);

    await thread.send({
      content: s('ticket.openingMessage', {
        user: `<@${interaction.user.id}>`,
        staff: config.ticketStaffRoleId ? `<@&${config.ticketStaffRoleId}>` : 'The team',
      }),
      embeds: [ticketEmbed(ticket, config, s, interaction.user.tag)],
      components: ticketComponents(ticket, s),
      allowedMentions: {
        users: [interaction.user.id],
        roles: config.ticketStaffRoleId ? [config.ticketStaffRoleId] : [],
      },
    });

    await interaction.editReply({ content: s('ticket.created', { thread: `<#${thread.id}>` }) });

    log.info(
      { guild: interaction.guild.id, ticket: ticket.id, number, user: interaction.user.id },
      'ticket opened',
    );
  } catch (error) {
    log.error({ err: error, guild: interaction.guild.id }, 'failed to open ticket');
    await interaction.editReply({ content: s('common.genericError') });
  }
}

function optional(interaction: ModalSubmitInteraction, field: string): string | null {
  const value = interaction.fields.getTextInputValue(field)?.trim();
  return value ? value : null;
}

// ─────────────────────────────────────────────────────────────
//  Rendering
// ─────────────────────────────────────────────────────────────

export function ticketEmbed(
  ticket: Ticket,
  config: GuildConfig,
  s: Translate,
  reporterTag?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[ticket.status])
    .setTitle(truncate(s('ticket.embedTitle', { number: ticket.number, summary: ticket.title }), 256))
    .setDescription(truncate(ticket.body, 4000))
    .setTimestamp(new Date(ticket.created_at));

  embed.addFields({
    name: s('ticket.fieldReporter'),
    value: `<@${ticket.opener_id}>`,
    inline: true,
  });

  if (ticket.platform) {
    embed.addFields({ name: s('ticket.fieldPlatform'), value: ticket.platform, inline: true });
  }
  if (ticket.build_version) {
    embed.addFields({ name: s('ticket.fieldVersion'), value: `\`${ticket.build_version}\``, inline: true });
  }

  const status = s(STATUS_LABEL_KEYS[ticket.status]);
  const resolution = ticket.resolution ? ` · ${s(RESOLUTION_LABEL_KEYS[ticket.resolution])}` : '';
  embed.addFields({ name: s('ticket.fieldStatus'), value: `${status}${resolution}`, inline: true });

  if (reporterTag) embed.setFooter({ text: reporterTag });
  if (config.gameName && !reporterTag) embed.setFooter({ text: config.gameName });

  return embed;
}

export function ticketComponents(ticket: Ticket, s: Translate): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = new ActionRowBuilder<ButtonBuilder>();

  if (ticket.status === 'closed') {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(TicketIds.reopen(ticket.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(s('ticket.buttonReopen'))
        .setEmoji('↩️'),
    );
    return [buttons];
  }

  if (ticket.status === 'open') {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(TicketIds.claim(ticket.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(s('ticket.buttonClaim'))
        .setEmoji('🙋'),
    );
  }

  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(TicketIds.close(ticket.id))
      .setStyle(ButtonStyle.Danger)
      .setLabel(s('ticket.buttonClose'))
      .setEmoji('✅'),
  );

  return [buttons];
}

// ─────────────────────────────────────────────────────────────
//  Lifecycle handlers
// ─────────────────────────────────────────────────────────────

/**
 * Staff = the configured staff role, or anyone who can manage threads. The
 * reporter may always close their own ticket.
 */
export function isStaff(member: GuildMember | null, config: GuildConfig): boolean {
  if (!member) return false;
  if (config.ticketStaffRoleId && member.roles.cache.has(config.ticketStaffRoleId)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageThreads);
}

export async function handleClaim(interaction: ButtonInteraction, ticketId: number): Promise<void> {
  const { config, s } = contextFor(interaction.guildId!);
  const member = interaction.member as GuildMember | null;

  if (!isStaff(member, config)) {
    await interaction.reply({ content: s('common.missingPermission'), flags: MessageFlags.Ephemeral });
    return;
  }

  const ticket = claimTicket(ticketId);
  if (!ticket) return;

  await interaction.update({
    embeds: [ticketEmbed(ticket, config, s)],
    components: ticketComponents(ticket, s),
  });
  await interaction.followUp({ content: s('ticket.claimed', { user: `<@${interaction.user.id}>` }) });
}

/** The Close button opens an ephemeral picker so a resolution is always recorded. */
export async function handleCloseRequest(interaction: ButtonInteraction, ticketId: number): Promise<void> {
  const { config, s } = contextFor(interaction.guildId!);
  const ticket = ticketById(ticketId);
  if (!ticket) return;

  const member = interaction.member as GuildMember | null;
  const allowed = isStaff(member, config) || interaction.user.id === ticket.opener_id;

  if (!allowed) {
    await interaction.reply({ content: s('common.missingPermission'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (ticket.status === 'closed') {
    await interaction.reply({ content: s('ticket.alreadyClosed'), flags: MessageFlags.Ephemeral });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(TicketIds.resolve(ticket.id))
    .setPlaceholder(s('ticket.buttonClose'))
    .addOptions(
      TICKET_RESOLUTIONS.map((resolution) => ({
        label: s(RESOLUTION_LABEL_KEYS[resolution]),
        value: resolution,
      })),
    );

  await interaction.reply({
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleResolve(
  interaction: StringSelectMenuInteraction,
  ticketId: number,
): Promise<void> {
  const { config, s } = contextFor(interaction.guildId!);
  const resolution = interaction.values[0] as TicketResolution;

  const ticket = closeTicket(ticketId, resolution, interaction.user.id);
  if (!ticket) return;

  await interaction.update({
    content: s('ticket.closed', {
      user: `<@${interaction.user.id}>`,
      resolution: s(RESOLUTION_LABEL_KEYS[resolution]),
    }),
    components: [],
  });

  await refreshTicketMessage(interaction, ticket, config, s);

  const thread = interaction.channel;
  if (thread?.isThread()) {
    await thread
      .send({
        content: s('ticket.closed', {
          user: `<@${interaction.user.id}>`,
          resolution: s(RESOLUTION_LABEL_KEYS[resolution]),
        }),
        allowedMentions: { parse: [] },
      })
      .catch(() => null);
    // Archive rather than lock: the reporter can still reply if they disagree.
    await thread.setArchived(true, `Bug report #${ticket.number} closed`).catch(() => null);
  }

  log.info({ ticket: ticket.id, resolution, by: interaction.user.id }, 'ticket closed');
}

export async function handleReopen(interaction: ButtonInteraction, ticketId: number): Promise<void> {
  const { config, s } = contextFor(interaction.guildId!);
  const existing = ticketById(ticketId);
  if (!existing) return;

  const member = interaction.member as GuildMember | null;
  const allowed = isStaff(member, config) || interaction.user.id === existing.opener_id;

  if (!allowed) {
    await interaction.reply({ content: s('common.missingPermission'), flags: MessageFlags.Ephemeral });
    return;
  }

  const ticket = reopenTicket(ticketId);
  if (!ticket) return;

  await interaction.update({
    embeds: [ticketEmbed(ticket, config, s)],
    components: ticketComponents(ticket, s),
  });
  await interaction.followUp({ content: s('ticket.reopened', { user: `<@${interaction.user.id}>` }) });
}

/**
 * The select menu lives on an ephemeral message, so we cannot edit the ticket
 * message through `interaction.update`. Re-fetch it from the thread instead.
 */
async function refreshTicketMessage(
  interaction: StringSelectMenuInteraction,
  ticket: Ticket,
  config: GuildConfig,
  s: Translate,
): Promise<void> {
  const thread = interaction.channel as GuildTextBasedChannel | null;
  if (!thread?.isThread()) return;

  try {
    const messages = await thread.messages.fetch({ limit: 5, after: '0' });
    const target = messages.find(
      (message) => message.author.id === interaction.client.user?.id && message.embeds.length > 0,
    );
    await target?.edit({
      embeds: [ticketEmbed(ticket, config, s)],
      components: ticketComponents(ticket, s),
    });
  } catch (error) {
    log.warn({ err: error, ticket: ticket.id }, 'could not refresh ticket message');
  }
}
