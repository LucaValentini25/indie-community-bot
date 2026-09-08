import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { env } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { migrations } from './migrations.js';

const log = createLogger('db');

/**
 * We use Node's built-in SQLite (`node:sqlite`) rather than better-sqlite3.
 * It needs no native compilation, which means the exact same code runs on a
 * Windows dev machine and inside a slim Linux container with no build
 * toolchain and no prebuilt-binary roulette.
 *
 * SQLite is the right call here: this bot is a single process with a modest
 * write volume, and a file on a persistent disk is far less to operate than a
 * Postgres server. Backing up is `cp bot.db*`.
 */
function open(): DatabaseSync {
  const path = resolve(env.DATABASE_PATH);
  mkdirSync(dirname(path), { recursive: true });

  const database = new DatabaseSync(path);

  // WAL lets reads proceed during writes and survives crashes cleanly.
  database.exec('PRAGMA journal_mode = WAL');
  // Good durability/throughput trade-off when journal_mode is WAL.
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec('PRAGMA foreign_keys = ON');
  // Wait instead of throwing SQLITE_BUSY if another statement holds the lock.
  database.exec('PRAGMA busy_timeout = 5000');

  log.info({ path }, 'database opened');
  return database;
}

export const db = open();

/** Applies any migration this database has not seen yet. */
export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((row) => row.id),
  );

  const pending = migrations.filter((migration) => !applied.has(migration.id));

  if (pending.length === 0) {
    log.debug({ count: migrations.length }, 'schema up to date');
    return;
  }

  for (const migration of pending) {
    log.info({ id: migration.id, name: migration.name }, 'applying migration');
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        Date.now(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      log.error({ err: error, id: migration.id }, 'migration failed; database left untouched');
      throw error;
    }
  }

  log.info({ applied: pending.length }, 'migrations complete');
}

/**
 * `node:sqlite` types every row as `Record<string, SQLOutputValue>`, so reading
 * one into a domain type needs a cast. These three helpers are the only place
 * that cast is allowed to live — the schema in `migrations.ts` is what makes it
 * sound, and keeping it here means a schema change has exactly one blast radius.
 */
type Param = string | number | null;

export function queryAll<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function queryOne<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

/**
 * For statements that cannot return zero rows — an `INSERT ... RETURNING *`, or
 * an aggregate like `COUNT(*)`. Throws rather than handing back a fake object.
 */
export function queryOneRequired<T>(sql: string, ...params: Param[]): T {
  const row = queryOne<T>(sql, ...params);
  if (row === undefined) {
    throw new Error(`Expected exactly one row from: ${sql.trim().slice(0, 120)}`);
  }
  return row;
}

export function closeDatabase(): void {
  try {
    // Fold the WAL back into the main file so a copied .db is self-contained.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    log.info('database closed');
  } catch (error) {
    log.warn({ err: error }, 'error while closing database');
  }
}
