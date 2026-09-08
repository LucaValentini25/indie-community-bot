import { en } from './locales/en.js';
import { es } from './locales/es.js';

/** Same shape as the reference locale, but with plain `string` values. */
type Translated<T> = { [K in keyof T]: T[K] extends string ? string : Translated<T[K]> };

export type LocaleStrings = Translated<typeof en>;

/** Dot-notation key of any leaf string, e.g. `'ticket.panelTitle'`. */
export type TranslationKey = {
  [K in keyof LocaleStrings & string]: `${K}.${keyof LocaleStrings[K] & string}`;
}[keyof LocaleStrings & string];

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

const bundles: Record<Locale, LocaleStrings> = { en, es };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * How each language names itself. Used as the heading of each block in a
 * bilingual post.
 *
 * Deliberately no flag emoji: 🇪🇸 reads as "Spain" to a Latin American
 * audience and 🇬🇧/🇺🇸 forces a pick between them. A language is not a country.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'ENGLISH',
  es: 'ESPAÑOL',
};

/**
 * Maps a Discord client locale to one of ours.
 *
 * Discord sends BCP-47-ish tags — `es-ES`, `es-419`, `en-US`, `en-GB`. We only
 * care about the language subtag; regional variants collapse together.
 * Anything we do not speak returns null so the caller can fall back to the
 * server's language rather than silently defaulting to English.
 */
export function localeFromDiscord(discordLocale: string | null | undefined): Locale | null {
  if (!discordLocale) return null;
  const language = discordLocale.split('-')[0]?.toLowerCase();
  return language && isLocale(language) ? language : null;
}

/**
 * Looks up a translation and fills `{placeholders}`.
 *
 * Falls back to English when a key is missing from a locale, and returns the
 * key itself if it is missing everywhere — a visibly broken string in Discord
 * beats a crash mid-interaction.
 */
export function t(locale: Locale, key: TranslationKey, params: Record<string, string | number> = {}): string {
  const raw = lookup(bundles[locale], key) ?? lookup(bundles.en, key);

  if (raw === undefined) return key;

  return raw.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

function lookup(bundle: LocaleStrings, key: string): string | undefined {
  const [section, entry] = key.split('.');
  if (!section || !entry) return undefined;
  const group = (bundle as Record<string, Record<string, string>>)[section];
  return group?.[entry];
}

/** Convenience wrapper so handlers can do `const s = translator(config.locale)`. */
export function translator(locale: Locale) {
  return (key: TranslationKey, params?: Record<string, string | number>) => t(locale, key, params);
}

export type Translate = ReturnType<typeof translator>;
