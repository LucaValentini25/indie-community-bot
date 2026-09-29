import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrations } from '../../src/db/migrations.js';

/**
 * Writes `worker/migrations/*.sql` from the same ordered list the always-on bot
 * runs at startup, so the two databases can never end up with different
 * schemas.
 *
 * Wrangler applies these with `wrangler d1 migrations apply`, in filename
 * order, once each — the same contract as `src/db/migrations.ts`. The output is
 * committed so a deploy does not depend on running this first, and CI can fail
 * the build if it is stale.
 *
 *   npm run worker:migrations
 */
const dir = join(import.meta.dirname, '..', 'migrations');

mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) {
  if (file.endsWith('.sql')) rmSync(join(dir, file));
}

for (const migration of migrations) {
  const name = `${String(migration.id).padStart(4, '0')}_${migration.name}.sql`;
  const header = `-- Generated from src/db/migrations.ts (id ${migration.id}). Do not edit by hand:\n-- change the source and run \`npm run worker:migrations\`.\n`;
  writeFileSync(join(dir, name), header + migration.sql.replace(/^\n/, ''));
  console.log(`wrote ${name}`);
}
