import type { Db } from './db.js';
import type { Rest } from './discord/rest.js';

/** Bindings and secrets. Secrets are set with `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  WEBHOOK_SECRET?: string;
  DEFAULT_LOCALE?: string;
}

/**
 * Everything a handler needs, built once per request.
 *
 * There is no module-level cache of guild data on purpose: a Worker isolate is
 * reused unpredictably and several run at once, so anything cached across
 * requests could be stale the moment another isolate writes. `memo` lives and
 * dies with a single request, which is the only lifetime that is safe.
 */
export interface App {
  readonly env: Env;
  readonly db: Db;
  readonly rest: Rest;
  /** The bot's own user id, read from the token — no API call needed. */
  readonly botId: string;
  /** Names of every command the router knows, for `/access` autocomplete. */
  readonly commandNames: readonly string[];
  readonly memo: Map<string, Promise<unknown>>;
}

export function memo<T>(app: App, key: string, load: () => Promise<T>): Promise<T> {
  let cached = app.memo.get(key) as Promise<T> | undefined;
  if (!cached) {
    cached = load();
    app.memo.set(key, cached);
  }
  return cached;
}
