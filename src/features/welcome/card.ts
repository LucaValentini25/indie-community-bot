import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createLogger } from '../../core/logger.js';
import { truncate } from '../../lib/text.js';

const log = createLogger('welcome-card');

const WIDTH = 1000;
const HEIGHT = 350;
const AVATAR_SIZE = 180;
const AVATAR_CENTER = { x: 175, y: HEIGHT / 2 };
const TEXT_LEFT = 310;

const ASSETS = join(process.cwd(), 'assets', 'welcome');
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

/**
 * Any .ttf/.otf dropped into `assets/fonts` is registered under the family
 * name "Brand". If the game has its own typeface, putting the file there is
 * the only step needed to use it on the card.
 */
let brandFontFamily: string | null = null;

export function registerFonts(): void {
  if (!existsSync(FONT_DIR)) return;

  for (const file of readdirSync(FONT_DIR)) {
    if (!['.ttf', '.otf'].includes(extname(file).toLowerCase())) continue;
    try {
      GlobalFonts.registerFromPath(join(FONT_DIR, file), 'Brand');
      brandFontFamily = 'Brand';
      log.info({ file }, 'registered custom font');
    } catch (error) {
      log.warn({ err: error, file }, 'could not register font');
    }
  }
}

/**
 * Font stack. "Brand" wins when the user supplied one; DejaVu Sans is what the
 * container image installs; the generic families cover a dev machine.
 */
function font(weight: 'bold' | 'normal', size: number): string {
  const families = [brandFontFamily, 'DejaVu Sans', 'Segoe UI', 'Arial', 'sans-serif']
    .filter(Boolean)
    .map((family) => `"${family}"`)
    .join(', ');
  return `${weight} ${size}px ${families}`;
}

export interface WelcomeCardInput {
  username: string;
  avatarUrl: string;
  /** Big label above the name, e.g. "WELCOME". */
  title: string;
  /** Small line below the name, e.g. "You are member #142". */
  subtitle: string;
  /** Shown bottom-right. Usually the game name. */
  footer?: string | null;
  /** `#rrggbb`. Drives the avatar ring and the accent bar. */
  accentColor: string;
  /** Overrides `assets/welcome/background.png`. */
  backgroundUrl?: string | null;
}

export async function renderWelcomeCard(input: WelcomeCardInput): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const accent = input.accentColor || '#5865F2';

  await drawBackground(ctx, input.backgroundUrl ?? null, accent);
  drawAccentBar(ctx, accent);
  await drawAvatar(ctx, input.avatarUrl, accent);
  drawText(ctx, input, accent);

  return canvas.toBuffer('image/png');
}

async function drawBackground(
  ctx: SKRSContext2D,
  backgroundUrl: string | null,
  accent: string,
): Promise<void> {
  const image = await loadBackground(backgroundUrl);

  if (image) {
    // Cover: fill the card without distorting the source aspect ratio.
    const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, (WIDTH - drawWidth) / 2, (HEIGHT - drawHeight) / 2, drawWidth, drawHeight);

    // Darken so light artwork never swallows the text.
    const scrim = ctx.createLinearGradient(0, 0, WIDTH, 0);
    scrim.addColorStop(0, 'rgba(6, 8, 14, 0.86)');
    scrim.addColorStop(1, 'rgba(6, 8, 14, 0.55)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  // No artwork: a dark base…
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#0b0e14');
  gradient.addColorStop(0.6, '#121722');
  gradient.addColorStop(1, '#171d2b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // …with the accent as a contained glow in the far corner rather than a wash
  // across half the card, which muddied light accent colours.
  const glow = ctx.createRadialGradient(
    WIDTH * 0.94,
    HEIGHT * 0.9,
    0,
    WIDTH * 0.94,
    HEIGHT * 0.9,
    WIDTH * 0.5,
  );
  glow.addColorStop(0, withAlpha(accent, 0.42));
  glow.addColorStop(0.5, withAlpha(accent, 0.12));
  glow.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Vignette so the card does not read as a flat rectangle.
  const vignette = ctx.createRadialGradient(
    WIDTH * 0.35,
    HEIGHT / 2,
    HEIGHT / 3,
    WIDTH * 0.35,
    HEIGHT / 2,
    WIDTH,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

async function loadBackground(backgroundUrl: string | null): Promise<Image | null> {
  const candidates = [backgroundUrl, join(ASSETS, 'background.png'), join(ASSETS, 'background.jpg')].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    try {
      if (candidate.startsWith('http')) {
        const data = await fetchImage(candidate);
        if (data) return await loadImage(data);
      } else if (existsSync(candidate)) {
        return await loadImage(candidate);
      }
    } catch (error) {
      log.warn({ err: error, candidate }, 'could not load background, trying next');
    }
  }

  return null;
}

function drawAccentBar(ctx: SKRSContext2D, accent: string): void {
  ctx.fillStyle = accent;
  ctx.fillRect(0, HEIGHT - 8, WIDTH, 8);
}

async function drawAvatar(ctx: SKRSContext2D, avatarUrl: string, accent: string): Promise<void> {
  const radius = AVATAR_SIZE / 2;

  // Accent ring
  ctx.beginPath();
  ctx.arc(AVATAR_CENTER.x, AVATAR_CENTER.y, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  // Dark gap between the ring and the avatar
  ctx.beginPath();
  ctx.arc(AVATAR_CENTER.x, AVATAR_CENTER.y, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 12, 18, 0.95)';
  ctx.fill();

  const data = await fetchImage(avatarUrl);
  if (!data) return;

  try {
    const avatar = await loadImage(data);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_CENTER.x, AVATAR_CENTER.y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, AVATAR_CENTER.x - radius, AVATAR_CENTER.y - radius, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } catch (error) {
    log.warn({ err: error }, 'could not draw avatar; card rendered without it');
  }
}

function drawText(ctx: SKRSContext2D, input: WelcomeCardInput, accent: string): void {
  ctx.textBaseline = 'alphabetic';

  // Title — small, tracked out, accent coloured.
  ctx.font = font('bold', 26);
  ctx.fillStyle = accent;
  drawTracked(ctx, input.title.toUpperCase(), TEXT_LEFT, 128, 6);

  // Username — the hero line, shrunk to fit rather than clipped.
  const name = truncate(input.username, 30);
  let size = 58;
  do {
    ctx.font = font('bold', size);
    size -= 2;
  } while (ctx.measureText(name).width > WIDTH - TEXT_LEFT - 60 && size > 26);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 12;
  ctx.fillText(name, TEXT_LEFT, 196);
  ctx.shadowBlur = 0;

  // Subtitle
  ctx.font = font('normal', 24);
  ctx.fillStyle = 'rgba(233, 236, 244, 0.78)';
  ctx.fillText(truncate(input.subtitle, 48), TEXT_LEFT, 238);

  // Footer, bottom-right
  if (input.footer) {
    ctx.font = font('bold', 20);
    ctx.fillStyle = 'rgba(233, 236, 244, 0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(truncate(input.footer, 32), WIDTH - 40, HEIGHT - 34);
    ctx.textAlign = 'left';
  }
}

/** Manual letter-spacing: `ctx.letterSpacing` is not available everywhere. */
function drawTracked(ctx: SKRSContext2D, text: string, x: number, y: number, tracking: number): void {
  let cursor = x;
  for (const character of text) {
    ctx.fillText(character, cursor, y);
    cursor += ctx.measureText(character).width + tracking;
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      log.warn({ url, status: response.status }, 'image fetch failed');
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    log.warn({ err: error, url }, 'image fetch threw');
    return null;
  }
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return `rgba(88, 101, 242, ${alpha})`;
  const [, r, g, b] = match;
  return `rgba(${parseInt(r!, 16)}, ${parseInt(g!, 16)}, ${parseInt(b!, 16)}, ${alpha})`;
}
