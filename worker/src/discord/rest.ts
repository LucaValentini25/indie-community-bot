import type {
  APIChannel,
  APIGuild,
  APIGuildMember,
  APIMessage,
  APIRole,
  RESTPostAPIChannelThreadsJSONBody,
} from 'discord-api-types/v10';
import { createLogger } from '../logger.js';

const log = createLogger('rest');

const API = 'https://discord.com/api/v10';

/** A non-2xx answer from Discord, with the fields callers actually branch on. */
export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    /** Discord's own error code, e.g. 50013 = Missing Permissions. */
    readonly code: number | undefined,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`${method} ${path} -> ${status}${code ? ` (${code})` : ''}: ${detail}`);
    this.name = 'DiscordApiError';
  }
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number>;
  /** Shows up in the server's audit log. */
  reason?: string;
  /** Interaction webhooks are authenticated by their token, not the bot's. */
  authenticated?: boolean;
}

/**
 * Discord's REST API over plain `fetch`.
 *
 * discord.js is not used at runtime here: it pulls in Node-only modules and
 * would blow the Worker size budget. Only the handful of endpoints this bot
 * needs are wrapped.
 */
export class Rest {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));

    const headers: Record<string, string> = {
      'user-agent': 'DiscordBot (https://github.com/indie-community-bot, 0.1.0)',
    };
    if (options.authenticated !== false) headers.authorization = `Bot ${this.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    // Header values must be latin-1; the reason can contain a display name.
    if (options.reason) headers['x-audit-log-reason'] = encodeURIComponent(options.reason);

    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      if (response.status === 429 && attempt === 0) {
        const body = (await response.json()) as { retry_after?: number };
        const wait = Math.min(Number(body.retry_after ?? 1), 3);
        log.warn({ method, path, wait }, 'rate limited, retrying once');
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      if (!response.ok) {
        let code: number | undefined;
        let detail = text.slice(0, 300);
        try {
          const parsed = JSON.parse(text) as { code?: number; message?: string };
          code = parsed.code;
          detail = parsed.message ?? detail;
        } catch {
          // Not JSON; keep the raw text.
        }
        throw new DiscordApiError(response.status, code, method, path, detail);
      }

      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  // ── Guilds ────────────────────────────────────────────────────────────────
  getGuild(guildId: string): Promise<APIGuild> {
    return this.request('GET', `/guilds/${guildId}`);
  }

  getGuildRoles(guildId: string): Promise<APIRole[]> {
    return this.request('GET', `/guilds/${guildId}/roles`);
  }

  getGuildMember(guildId: string, userId: string): Promise<APIGuildMember> {
    return this.request('GET', `/guilds/${guildId}/members/${userId}`);
  }

  /** Avatar, banner and nickname of the bot in one server. */
  editMyMember(
    guildId: string,
    body: { nick?: string | null; avatar?: string | null; banner?: string | null },
  ): Promise<APIGuildMember> {
    return this.request('PATCH', `/guilds/${guildId}/members/@me`, { body });
  }

  addMemberRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void> {
    return this.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
  }

  removeMemberRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason });
  }

  // ── Channels & messages ───────────────────────────────────────────────────
  getChannel(channelId: string): Promise<APIChannel> {
    return this.request('GET', `/channels/${channelId}`);
  }

  createMessage(channelId: string, body: unknown): Promise<APIMessage> {
    return this.request('POST', `/channels/${channelId}/messages`, { body });
  }

  editMessage(channelId: string, messageId: string, body: unknown): Promise<APIMessage> {
    return this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, { body });
  }

  listMessages(channelId: string, query: Record<string, string | number>): Promise<APIMessage[]> {
    return this.request('GET', `/channels/${channelId}/messages`, { query });
  }

  startThread(
    channelId: string,
    body: RESTPostAPIChannelThreadsJSONBody,
    reason?: string,
  ): Promise<APIChannel> {
    return this.request('POST', `/channels/${channelId}/threads`, { body, reason });
  }

  addThreadMember(threadId: string, userId: string): Promise<void> {
    return this.request('PUT', `/channels/${threadId}/thread-members/${userId}`);
  }

  archiveThread(threadId: string, reason: string): Promise<APIChannel> {
    return this.request('PATCH', `/channels/${threadId}`, { body: { archived: true }, reason });
  }

  // ── Interaction webhooks ──────────────────────────────────────────────────
  editOriginalResponse(applicationId: string, token: string, body: unknown): Promise<APIMessage> {
    return this.request('PATCH', `/webhooks/${applicationId}/${token}/messages/@original`, {
      body,
      authenticated: false,
    });
  }

  createFollowup(applicationId: string, token: string, body: unknown): Promise<APIMessage> {
    return this.request('POST', `/webhooks/${applicationId}/${token}`, { body, authenticated: false });
  }
}

/** A bot token starts with the bot's user id, base64-encoded. */
export function botIdFromToken(token: string): string {
  const [encoded] = token.split('.');
  if (!encoded) throw new Error('DISCORD_TOKEN does not look like a bot token');
  return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
}
