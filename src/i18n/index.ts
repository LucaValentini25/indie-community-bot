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
