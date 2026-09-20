import { z } from 'zod';
import { announceBuild } from './features/builds.js';
import { createLogger } from './logger.js';
import type { App } from './types.js';

const log = createLogger('hooks');

/** Refuse oversized bodies before parsing them. */
const MAX_BODY_BYTES = 64 * 1024;

const buildPayload = z.object({
  guildId: z.string().regex(/^\d{17,20}$/, 'guildId must be a Discord snowflake'),
  version: z.string().min(1).max(60),
  channel: z.string().max(40).optional(),
  platforms: z.string().max(200).optional(),
  // Changelog for the server's primary language — the simple case.
  notes: z.string().max(3800).optional(),
  // Per-language changelog. Either or both; each overrides `notes` for its language.
  notesEn: z.string().max(3800).optional(),
  notesEs: z.string().max(3800).optional(),
  url: z.url().optional(),
  source: z.string().max(40).optional(),
  force: z.boolean().optional(),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Constant-time secret comparison.
 *
 * Both sides are hashed first, which gives equal-length digests to compare —
 * a plain length check would leak the secret's length, and there is no
 * `timingSafeEqual` in the standard Web Crypto API.
 */
async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const encode = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([encode(provided), encode(expected)]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);

  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

/**
 * `POST /hooks/build`, called by CI when a build ships. Same contract as the
 * always-on bot's webhook, so `examples/github-actions/notify-bot.yml` works
 * unchanged — only the URL differs.
 */
export async function handleBuildHook(app: App, request: Request): Promise<Response> {
  const secret = app.env.WEBHOOK_SECRET;
  const header =
    request.headers.get('x-webhook-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!secret || !header || !(await secretMatches(header, secret))) {
    log.warn({}, 'rejected build hook: bad or missing secret');
    return json(401, { error: 'unauthorized' });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const parsed = buildPayload.safeParse(body);
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_payload',
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
  }

  const { notesEn, notesEs, ...build } = parsed.data;

  const result = await announceBuild(app, {
    ...build,
    notesByLocale: { ...(notesEn ? { en: notesEn } : {}), ...(notesEs ? { es: notesEs } : {}) },
    source: parsed.data.source ?? 'ci',
  });

  if (result.ok) return json(200, { status: 'announced', messageId: result.messageId });

  // A duplicate is not an error for CI: a re-run should be a no-op, not a red build.
  if (result.reason === 'duplicate') return json(200, { status: 'already_announced' });

  return json(result.reason === 'guild-unavailable' ? 404 : 409, {
    error: result.reason,
    ...(result.reason === 'channel' ? { detail: result.message } : {}),
  });
}
