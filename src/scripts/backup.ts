/**
 * Writes a consistent snapshot of the database to a file.
 *
 *   node dist/scripts/backup.js [destination]
 *
 * Uses SQLite's `VACUUM INTO`, which is safe to run against a live database:
 * it takes a read transaction and writes a compacted, self-contained copy.
 * Plain `cp` of a WAL-mode database while the bot is writing can produce a
 * torn file, which is exactly the kind of backup you discover is broken on the
 * day you need it.
 */
process.env.DISCORD_TOKEN ??= 'backup';
process.env.DISCORD_CLIENT_ID ??= '000000000000000000';
process.env.LOG_LEVEL ??= 'silent';

const { DatabaseSync } = await import('node:sqlite');
const { statSync, rmSync, existsSync } = await import('node:fs');
const { resolve } = await import('node:path');

const source = resolve(process.env.DATABASE_PATH ?? './data/bot.db');
const destination = resolve(process.argv[2] ?? './data/backup.db');

if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

// VACUUM INTO refuses to overwrite an existing file.
if (existsSync(destination)) rmSync(destination);

const database = new DatabaseSync(source, { readOnly: true });
database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
database.close();

const { size } = statSync(destination);
console.log(`${destination} (${(size / 1024).toFixed(0)} KB)`);
