export type SqlValue = string | number | null;

/**
 * A thin, typed wrapper over D1.
 *
 * D1 is SQLite, so the SQL and the migrations are the ones the always-on bot
 * uses. The difference is that every call is async — hence `await` on every
 * read that used to be synchronous.
 */
export class Db {
  constructor(private readonly d1: D1Database) {}

  /**
   * The first row, or undefined. Goes through `all()` rather than D1's
   * `first()` because several callers use `UPDATE … RETURNING` / `INSERT …
   * RETURNING`, and `all()` is the call D1 documents for statements that
   * return rows while writing.
   */
  async first<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    const result = await this.d1
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return result.results[0];
  }

  async firstRequired<T>(sql: string, ...params: SqlValue[]): Promise<T> {
    const row = await this.first<T>(sql, ...params);
    if (row === undefined) throw new Error(`Expected a row from: ${sql}`);
    return row;
  }

  async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    const result = await this.d1
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return result.results;
  }

  /** Runs a write and returns how many rows it touched. */
  async run(sql: string, ...params: SqlValue[]): Promise<number> {
    const result = await this.d1
      .prepare(sql)
      .bind(...params)
      .run();
    return result.meta.changes ?? 0;
  }
}
