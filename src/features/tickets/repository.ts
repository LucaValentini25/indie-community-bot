import { db, queryAll, queryOne, queryOneRequired } from '../../db/index.js';

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
  status: TicketStatus;
  resolution: TicketResolution | null;
  closed_by: string | null;
  created_at: number;
  closed_at: number | null;
}

export interface CreateTicketInput {
  guildId: string;
  number: number;
  threadId: string;
  openerId: string;
  category: string;
  title: string;
  body: string;
  platform: string | null;
  buildVersion: string | null;
}

export function createTicket(input: CreateTicketInput): Ticket {
  return queryOneRequired<Ticket>(
    `INSERT INTO tickets
       (guild_id, number, thread_id, opener_id, category, title, body, platform, build_version, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
     RETURNING *`,
    input.guildId,
    input.number,
    input.threadId,
    input.openerId,
    input.category,
    input.title,
    input.body,
    input.platform,
    input.buildVersion,
    Date.now(),
  );
}

export function ticketById(id: number): Ticket | undefined {
  return queryOne<Ticket>('SELECT * FROM tickets WHERE id = ?', id);
}

export function ticketByThread(threadId: string): Ticket | undefined {
  return queryOne<Ticket>('SELECT * FROM tickets WHERE thread_id = ?', threadId);
}

export function claimTicket(id: number): Ticket | undefined {
  db.prepare("UPDATE tickets SET status = 'claimed' WHERE id = ? AND status = 'open'").run(id);
  return ticketById(id);
}

export function closeTicket(id: number, resolution: TicketResolution, closedBy: string): Ticket | undefined {
  db.prepare(
    "UPDATE tickets SET status = 'closed', resolution = ?, closed_by = ?, closed_at = ? WHERE id = ?",
  ).run(resolution, closedBy, Date.now(), id);
  return ticketById(id);
}

export function reopenTicket(id: number): Ticket | undefined {
  db.prepare(
    "UPDATE tickets SET status = 'open', resolution = NULL, closed_by = NULL, closed_at = NULL WHERE id = ?",
  ).run(id);
  return ticketById(id);
}

export function openTickets(guildId: string, limit = 25): Ticket[] {
  return queryAll<Ticket>(
    "SELECT * FROM tickets WHERE guild_id = ? AND status != 'closed' ORDER BY created_at ASC LIMIT ?",
    guildId,
    limit,
  );
}

export function ticketStats(guildId: string): { open: number; claimed: number; closed: number } {
  const rows = queryAll<{ status: TicketStatus; count: number }>(
    'SELECT status, COUNT(*) AS count FROM tickets WHERE guild_id = ? GROUP BY status',
    guildId,
  );

  const stats = { open: 0, claimed: 0, closed: 0 };
  for (const row of rows) stats[row.status] = row.count;
  return stats;
}
