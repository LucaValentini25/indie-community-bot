import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
} from '@discordjs/builders';
import { ButtonStyle, ChannelType, TextInputStyle } from 'discord-api-types/v10';
import {
  brandedEmbed,
  contextForUser,
  describeChannelFailure,
  localeRenderers,
  resolveSendableChannel,
} from '../lib/context.js';
import { nextTicketNumber, type GuildConfig } from '../config/guild.js';
import { createLogger } from '../logger.js';
import { slugify, truncate } from '../../../src/lib/text.js';
import { isLocale, translator, type Translate, type TranslationKey } from '../../../src/i18n/index.js';
import { has, Perm } from '../discord/permissions.js';
import { EPHEMERAL } from '../discord/message.js';
import type { Interaction, InteractionMember } from '../discord/interaction.js';
import type { App } from '../types.js';

const log = createLogger('tickets');

// ─────────────────────────────────────────────────────────────
//  Storage
// ─────────────────────────────────────────────────────────────

export const TICKET_STATUSES = ['open', 'claimed', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Resolution keys. The label shown to users comes from `ticket.resolution*`. */
export const TICKET_RESOLUTIONS = ['fixed', 'duplicate', 'notABug', 'wontFix', 'noRepro'] as const;
export type TicketResolution = (typeof TICKET_RESOLUTIONS)[number];

export interface Ticket {
  id: number;
  guild_id: string;
  number: number;
  thread_id: string;
  opener_id: string;
  category: string;
  title: string;
  body: string;
  platform: string | null;
  build_version: string | null;
  /** The language the report was filed in. NULL for rows predating i18n. */
  locale: string | null;
  status: TicketStatus;
  resolution: TicketResolution | null;
  closed_by: string | null;
  created_at: number;
  closed_at: number | null;
}

export function ticketById(app: App, id: number): Promise<Ticket | undefined> {
  return app.db.first<Ticket>('SELECT * FROM tickets WHERE id = ?', id);
}

async function claimTicket(app: App, id: number): Promise<Ticket | undefined> {
  await app.db.run("UPDATE tickets SET status = 'claimed' WHERE id = ? AND status = 'open'", id);
  return ticketById(app, id);
}

async function closeTicket(
  app: App,
  id: number,
  resolution: TicketResolution,
  closedBy: string,
): Promise<Ticket | undefined> {
  await app.db.run(
    "UPDATE tickets SET status = 'closed', resolution = ?, closed_by = ?, closed_at = ? WHERE id = ?",
    resolution,
    closedBy,
    Date.now(),
    id,
  );
  return ticketById(app, id);
}

async function reopenTicket(app: App, id: number): Promise<Ticket | undefined> {
  await app.db.run(
    "UPDATE tickets SET status = 'open', resolution = NULL, closed_by = NULL, closed_at = NULL WHERE id = ?",
    id,
  );
  return ticketById(app, id);
}

export function openTickets(app: App, guildId: string, limit = 25): Promise<Ticket[]> {
  return app.db.all<Ticket>(
    "SELECT * FROM tickets WHERE guild_id = ? AND status != 'closed' ORDER BY created_at ASC LIMIT ?",
    guildId,
    limit,
  );
}

export async function ticketStats(
  app: App,
  guildId: string,
): Promise<{ open: number; claimed: number; closed: number }> {
  const rows = await app.db.all<{ status: TicketStatus; count: number }>(
    'SELECT status, COUNT(*) AS count FROM tickets WHERE guild_id = ? GROUP BY status',
    guildId,
  );

  const stats = { open: 0, claimed: 0, closed: 0 };
  for (const row of rows) stats[row.status] = row.count;
  return stats;
}

// ─────────────────────────────────────────────────────────────
//  Ids and labels
// ─────────────────────────────────────────────────────────────

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

/**
 * The always-on message with the "Report a bug" button.
 *
 * In a bilingual server this is one message with one embed per language. The
 * button carries one label for both, because a component has only one.
 */
export function buildPanel(config: GuildConfig): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const renderers = localeRenderers(config);
  const bilingual = renderers.length > 1;

  const embeds = renderers.map((renderer) => {
    const embed = brandedEmbed(config)
      .setTitle(renderer.s('ticket.panelTitle'))
      .setDescription(renderer.s('ticket.panelDescription'));
    if (bilingual) embed.setAuthor({ name: renderer.label });
    return embed;
  });

  const label = truncate(renderers.map((renderer) => renderer.s('ticket.panelButton')).join(' · '), 80);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(TicketIds.openButton)
      .setStyle(ButtonStyle.Primary)
      .setLabel(label)
      .setEmoji({ name: '🐛' }),
  );

  return { embeds, components: [row] };
}

/** A bug thread speaks the language its reporter filed it in, not the server's. */
export function ticketTranslator(ticket: Ticket, config: GuildConfig): Translate {
  return translator(ticket.locale && isLocale(ticket.locale) ? ticket.locale : config.locale);
}

// ─────────────────────────────────────────────────────────────
//  Open flow
// ─────────────────────────────────────────────────────────────

function textRow(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

export async function showReportModal(app: App, ix: Interaction): Promise<void> {
  // The form is for one person; show it in their language.
  const { s } = await contextForUser(app, ix.guildId!, ix.locale);

  const modal = new ModalBuilder().setCustomId(TicketIds.modal).setTitle(s('ticket.modalTitle'));

  modal.addComponents(
    textRow(
      new TextInputBuilder()
        .setCustomId(Fields.summary)
        .setLabel(truncate(s('ticket.modalSummaryLabel'), 45))
        .setPlaceholder(truncate(s('ticket.modalSummaryPlaceholder'), 100))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(120)
        .setRequired(true),
    ),
    textRow(
      new TextInputBuilder()
        .setCustomId(Fields.details)
        .setLabel(truncate(s('ticket.modalDetailsLabel'), 45))
        .setPlaceholder(truncate(s('ticket.modalDetailsPlaceholder'), 100))
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true),
    ),
    textRow(
      new TextInputBuilder()
        .setCustomId(Fields.platform)
        .setLabel(truncate(s('ticket.modalPlatformLabel'), 45))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(60)
        .setRequired(false),
    ),
    textRow(
      new TextInputBuilder()
        .setCustomId(Fields.version)
        .setLabel(truncate(s('ticket.modalVersionLabel'), 45))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(40)
        .setRequired(false),
    ),
  );

  await ix.showModal(modal);
}

export async function handleReportSubmit(app: App, ix: Interaction): Promise<void> {
  const guildId = ix.guildId;
  if (!guildId) return;
  const { config, s, locale } = await contextForUser(app, guildId, ix.locale);

  // Creating a thread and posting into it takes longer than the 3s interaction
  // window, so acknowledge first.
  await ix.deferReply({ flags: EPHEMERAL });

  const summary = ix.fields.getText(Fields.summary).trim();
  const details = ix.fields.getText(Fields.details).trim();
  const platform = ix.fields.getText(Fields.platform).trim() || null;
  const version = ix.fields.getText(Fields.version).trim() || null;

  const configured = await resolveSendableChannel(app, guildId, config.ticketChannelId, [
    Perm.ViewChannel,
    Perm.SendMessages,
    Perm.CreatePrivateThreads,
    Perm.SendMessagesInThreads,
  ]);

  if (!configured.ok) {
    await ix.editReply({ content: describeChannelFailure(configured, s) });
    return;
  }

  const parent = configured.channel;
  if (parent.type !== ChannelType.GuildText) {
    await ix.editReply({ content: s('common.channelUnavailable') });
    return;
  }

  const number = await nextTicketNumber(app, guildId);
  const user = ix.user;

  try {
    const thread = await app.rest.startThread(
      parent.id,
      {
        name: truncate(s('ticket.threadName', { number, summary: slugify(summary, 40) }), 100),
        type: ChannelType.PrivateThread,
        // Keep the thread visible only to people explicitly added plus staff.
        invitable: false,
        auto_archive_duration: 10080, // 7 days
      },
      `Bug report #${number} by ${user.username}`,
    );

    const ticket = await app.db.firstRequired<Ticket>(
      `INSERT INTO tickets
         (guild_id, number, thread_id, opener_id, category, title, body, platform, build_version, locale, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
       RETURNING *`,
      guildId,
      number,
      thread.id,
      user.id,
      'bug',
      summary,
      details,
      platform,
      version,
      locale,
      Date.now(),
    );

    await app.rest.addThreadMember(thread.id, user.id).catch(() => null);

    await app.rest.createMessage(thread.id, {
      content: s('ticket.openingMessage', {
        user: `<@${user.id}>`,
        staff: config.ticketStaffRoleId ? `<@&${config.ticketStaffRoleId}>` : 'The team',
      }),
      embeds: [ticketEmbed(ticket, config, s, user.username).toJSON()],
      components: ticketComponents(ticket, s).map((row) => row.toJSON()),
      allowed_mentions: {
        users: [user.id],
        roles: config.ticketStaffRoleId ? [config.ticketStaffRoleId] : [],
      },
    });

    await ix.editReply({ content: s('ticket.created', { thread: `<#${thread.id}>` }) });

    log.info({ guild: guildId, ticket: ticket.id, number, user: user.id }, 'ticket opened');
  } catch (error) {
    log.error({ err: error, guild: guildId }, 'failed to open ticket');
    await ix.editReply({ content: s('common.genericError') });
  }
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
        .setEmoji({ name: '↩️' }),
    );
    return [buttons];
  }

  if (ticket.status === 'open') {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(TicketIds.claim(ticket.id))
        .setStyle(ButtonStyle.Secondary)
        .setLabel(s('ticket.buttonClaim'))
        .setEmoji({ name: '🙋' }),
    );
  }

  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(TicketIds.close(ticket.id))
      .setStyle(ButtonStyle.Danger)
      .setLabel(s('ticket.buttonClose'))
      .setEmoji({ name: '✅' }),
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
export function isStaff(member: InteractionMember | null, config: GuildConfig): boolean {
  if (!member) return false;
  if (config.ticketStaffRoleId && member.roles.includes(config.ticketStaffRoleId)) return true;
  return has(member.permissions, Perm.ManageThreads);
}

export async function handleClaim(app: App, ix: Interaction, ticketId: number): Promise<void> {
  const { config, s } = await contextForUser(app, ix.guildId!, ix.locale);

  if (!isStaff(ix.member, config)) {
    await ix.reply({ content: s('common.missingPermission'), flags: EPHEMERAL });
    return;
  }

  const ticket = await claimTicket(app, ticketId);
  if (!ticket) return;

  const ts = ticketTranslator(ticket, config);
  await ix.update({
    embeds: [ticketEmbed(ticket, config, ts)],
    components: ticketComponents(ticket, ts),
  });
  await ix.followUp({ content: s('ticket.claimed', { user: `<@${ix.user.id}>` }) });
}

/** The Close button opens an ephemeral picker so a resolution is always recorded. */
export async function handleCloseRequest(app: App, ix: Interaction, ticketId: number): Promise<void> {
  const { config, s } = await contextForUser(app, ix.guildId!, ix.locale);
  const ticket = await ticketById(app, ticketId);
  if (!ticket) return;

  const allowed = isStaff(ix.member, config) || ix.user.id === ticket.opener_id;

  if (!allowed) {
    await ix.reply({ content: s('common.missingPermission'), flags: EPHEMERAL });
    return;
  }

  if (ticket.status === 'closed') {
    await ix.reply({ content: s('ticket.alreadyClosed'), flags: EPHEMERAL });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(TicketIds.resolve(ticket.id))
    .setPlaceholder(s('ticket.closePrompt'))
    .addOptions(
      TICKET_RESOLUTIONS.map((resolution) => ({
        label: s(RESOLUTION_LABEL_KEYS[resolution]),
        value: resolution,
      })),
    );

  await ix.reply({
    content: s('ticket.closePrompt'),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: EPHEMERAL,
  });
}

export async function handleResolve(app: App, ix: Interaction, ticketId: number): Promise<void> {
  const { config, s } = await contextForUser(app, ix.guildId!, ix.locale);
  const resolution = ix.values[0] as TicketResolution | undefined;
  if (!resolution || !TICKET_RESOLUTIONS.includes(resolution)) return;

  const ticket = await closeTicket(app, ticketId, resolution, ix.user.id);
  if (!ticket) return;

  const closedText = s('ticket.closed', {
    user: `<@${ix.user.id}>`,
    resolution: s(RESOLUTION_LABEL_KEYS[resolution]),
  });

  await ix.update({ content: closedText, components: [] });

  await refreshTicketMessage(app, ix, ticket, config);

  const threadId = ix.channelId;
  const inThread =
    ix.channelType === ChannelType.PrivateThread || ix.channelType === ChannelType.PublicThread;

  if (threadId && inThread) {
    await app.rest
      .createMessage(threadId, { content: closedText, allowed_mentions: { parse: [] } })
      .catch(() => null);
    // Archive rather than lock: the reporter can still reply if they disagree.
    await app.rest.archiveThread(threadId, `Bug report #${ticket.number} closed`).catch(() => null);
  }

  log.info({ ticket: ticket.id, resolution, by: ix.user.id }, 'ticket closed');
}

export async function handleReopen(app: App, ix: Interaction, ticketId: number): Promise<void> {
  const { config, s } = await contextForUser(app, ix.guildId!, ix.locale);
  const existing = await ticketById(app, ticketId);
  if (!existing) return;

  const allowed = isStaff(ix.member, config) || ix.user.id === existing.opener_id;

  if (!allowed) {
    await ix.reply({ content: s('common.missingPermission'), flags: EPHEMERAL });
    return;
  }

  const ticket = await reopenTicket(app, ticketId);
  if (!ticket) return;

  const ts = ticketTranslator(ticket, config);
  await ix.update({
    embeds: [ticketEmbed(ticket, config, ts)],
    components: ticketComponents(ticket, ts),
  });
  await ix.followUp({ content: s('ticket.reopened', { user: `<@${ix.user.id}>` }) });
}

/**
 * The select menu lives on an ephemeral message, so we cannot edit the ticket
 * message through `update`. Find it in the thread instead: it is the bot's own
 * message carrying an embed, one of the first few in the thread.
 */
async function refreshTicketMessage(
  app: App,
  ix: Interaction,
  ticket: Ticket,
  config: GuildConfig,
): Promise<void> {
  const threadId = ix.channelId;
  if (!threadId) return;

  try {
    const messages = await app.rest.listMessages(threadId, { limit: 5, after: '0' });
    const target = messages.find((message) => message.author.id === app.botId && message.embeds.length > 0);
    if (!target) return;

    const ts = ticketTranslator(ticket, config);
    await app.rest.editMessage(threadId, target.id, {
      embeds: [ticketEmbed(ticket, config, ts).toJSON()],
      components: ticketComponents(ticket, ts).map((row) => row.toJSON()),
    });
  } catch (error) {
    log.warn({ err: error, ticket: ticket.id }, 'could not refresh ticket message');
  }
}
