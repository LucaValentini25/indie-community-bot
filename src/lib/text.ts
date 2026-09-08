/** Cuts a string to `max` characters, appending an ellipsis when it had to cut. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Turns free text into something usable as a Discord thread/channel name:
 * lowercase, accent-free, hyphenated, capped.
 */
export function slugify(value: string, max = 60): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, max).replace(/-+$/, '') || 'report';
}

/**
 * Parses `#rrggbb` (or `rrggbb`) into the integer Discord expects.
 * Returns null on anything else so callers can fall back to a default.
 */
export function parseHexColor(value: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 16);
}

/** Discord's `<t:unix:R>` relative timestamp. */
export function relativeTime(timestampMs: number): string {
  return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

/** Discord's `<t:unix:f>` absolute timestamp. */
export function absoluteTime(timestampMs: number): string {
  return `<t:${Math.floor(timestampMs / 1000)}:f>`;
}

/** True for http(s) URLs only — used to validate user-supplied image links. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
