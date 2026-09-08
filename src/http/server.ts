import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Client } from 'discord.js';
import { env } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { announceBuild } from '../features/builds/index.js';

const log = createLogger('http');

/** Refuse oversized bodies before buffering them. */
const MAX_BODY_BYTES = 64 * 1024;

const buildPayload = z.object({
  guildId: z.string().regex(/^\d{17,20}$/, 'guildId must be a Discord snowflake'),
  version: z.string().min(1).max(60),
  channel: z.string().max(40).optional(),
  platforms: z.string().max(200).optional(),
  notes: z.string().max(3800).optional(),
  url: z.url().optional(),
  source: z.string().max(40).optional(),
  force: z.boolean().optional(),
});

/**
 * A deliberately tiny HTTP surface — no framework, two routes:
 *
 *   GET  /health       liveness probe for the host / uptime monitor
 *   POST /hooks/build  called by CI when a build ships
 *
 * The webhook exists so a build announcement carries the bot's identity, pings
 * the notification role and gets recorded in the database. If you would rather
 * not expose a port at all, CI can POST straight to a Discord webhook URL
 * instead — see docs/BUILD-NOTIFICATIONS.md.
 */
export function startHttpServer(client: Client): Server {
  const server = createServer((request, response) => {
    handle(client, request, response).catch((error) => {
      log.error({ err: error, url: request.url }, 'unhandled error in http handler');
      send(response, 500, { error: 'internal_error' });
    });
  });

  server.listen(env.HTTP_PORT, () => {
    log.info({ port: env.HTTP_PORT }, 'http server listening');
    if (!env.WEBHOOK_SECRET) {
      log.warn('WEBHOOK_SECRET is not set — POST /hooks/build will reject every request');
    }
  });

  return server;
}

async function handle(client: Client, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    send(response, 200, {
      status: client.isReady() ? 'ok' : 'starting',
      uptimeSeconds: Math.floor(process.uptime()),
      guilds: client.guilds.cache.size,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/hooks/build') {
    await handleBuildHook(client, request, response);
    return;
  }

  send(response, 404, { error: 'not_found' });
}

async function handleBuildHook(
  client: Client,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!authorize(request)) {
    log.warn({ ip: request.socket.remoteAddress }, 'rejected build hook: bad secret');
    send(response, 401, { error: 'unauthorized' });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(request);
  } catch (error) {
    send(response, 413, { error: (error as Error).message });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    send(response, 400, { error: 'invalid_json' });
    return;
  }

  const parsed = buildPayload.safeParse(json);
  if (!parsed.success) {
    send(response, 400, {
      error: 'invalid_payload',
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return;
  }

  const result = await announceBuild(client, {
    ...parsed.data,
    source: parsed.data.source ?? 'ci',
  });

  if (result.ok) {
    send(response, 200, { status: 'announced', messageId: result.messageId });
    return;
  }

  // A duplicate is not an error for CI: a re-run should be a no-op, not a red
  // build. Everything else is worth failing the workflow over.
  if (result.reason === 'duplicate') {
    send(response, 200, { status: 'already_announced' });
    return;
  }

  send(response, result.reason === 'guild-unavailable' ? 404 : 409, {
    error: result.reason,
    ...(result.reason === 'channel' ? { detail: result.message } : {}),
  });
}

/**
 * Accepts the secret via `X-Webhook-Secret` or `Authorization: Bearer <secret>`.
 * Compared in constant time so a wrong secret cannot be recovered by timing.
 */
function authorize(request: IncomingMessage): boolean {
  if (!env.WEBHOOK_SECRET) return false;

  const header =
    firstHeader(request.headers['x-webhook-secret']) ??
    firstHeader(request.headers.authorization)?.replace(/^Bearer\s+/i, '');

  if (!header) return false;

  const provided = Buffer.from(header);
  const expected = Buffer.from(env.WEBHOOK_SECRET);

  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}
