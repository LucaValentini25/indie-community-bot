import { loadImage } from '@napi-rs/canvas';
import { mkdirSync, existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { env } from '../../config/env.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('welcome-background');

/**
 * Per-guild welcome artwork: the URL goes in the database, the bytes go on the
 * data volume.
 *
 * Storing the image itself in SQLite would grow a file that gets vacuumed,
 * copied and backed up nightly by several megabytes per server, for something
 * that is not really data. Storing only the URL and fetching it on demand has
 * the opposite problem: **Discord attachment URLs expire.** Since 2023 they are
 * signed with `ex`/`is`/`hm` parameters and stop resolving after roughly a day,
 * so a link picked straight out of a Discord message works when an admin sets
 * it and silently stops working the next morning.
 *
 * So we do both: keep the URL as the record of intent, and cache the bytes
 * beside the database the moment it is set. That also keeps a member's join
 * off the network — the card renders from a local file.
 */
const CACHE_DIR = join(dirname(resolve(env.DATABASE_PATH)), 'backgrounds');

/** Discord's own attachment limit for a non-Nitro upload is well under this. */
const MAX_BYTES = 8 * 1024 * 1024;

export type BackgroundError = 'not-a-url' | 'unreachable' | 'not-an-image' | 'too-big' | 'undecodable';

/**
 * Fetches, validates and caches the artwork for one guild.
 *
 * Everything is checked here rather than at render time, so an admin finds out
 * immediately that the link is wrong instead of discovering it the next time
 * somebody joins — when nobody is watching and the card silently falls back to
 * the plain gradient.
 */
export async function cacheBackground(
  guildId: string,
  url: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: BackgroundError }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'not-a-url' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'not-a-url' };
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    log.warn({ err: error, guild: guildId }, 'background fetch threw');
    return { ok: false, reason: 'unreachable' };
  }

  if (!response.ok) return { ok: false, reason: 'unreachable' };

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) return { ok: false, reason: 'not-an-image' };

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: 'too-big' };

  // Decode it now. A truncated or mislabelled file passes every check above and
  // only fails inside the canvas, at render time.
  try {
    await loadImage(bytes);
  } catch {
    return { ok: false, reason: 'undecodable' };
  }

  const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

  mkdirSync(CACHE_DIR, { recursive: true });
  clearBackground(guildId); // a guild has one background; drop the old extension
  const path = join(CACHE_DIR, `${guildId}.${extension}`);
  writeFileSync(path, bytes);

  log.info({ guild: guildId, bytes: bytes.byteLength, path }, 'cached welcome background');
  return { ok: true, path };
}

/** The cached file for a guild, or null when there is none. */
export function cachedBackground(guildId: string): string | null {
  if (!existsSync(CACHE_DIR)) return null;
  for (const file of readdirSync(CACHE_DIR)) {
    if (file.startsWith(`${guildId}.`)) return join(CACHE_DIR, file);
  }
  return null;
}

export function clearBackground(guildId: string): void {
  const existing = cachedBackground(guildId);
  if (!existing) return;
  try {
    unlinkSync(existing);
  } catch (error) {
    log.warn({ err: error, guild: guildId }, 'could not remove cached background');
  }
}
