import { db, queryAll, queryOne } from '../../db/index.js';

export interface SelfRole {
  guild_id: string;
  role_id: string;
  /** What the button says when there is no per-locale copy for the viewer. */
  label: string;
  /** JSON keyed by locale, same shape as `builds.notes_i18n`. NULL when absent. */
  label_i18n: string | null;
  emoji: string | null;
  created_at: number;
}

/** Panel order. See the migration: stable across label edits, by design. */
export function listSelfRoles(guildId: string): SelfRole[] {
  return queryAll<SelfRole>('SELECT * FROM self_roles WHERE guild_id = ? ORDER BY created_at ASC', guildId);
}

export function selfRoleFor(guildId: string, roleId: string): SelfRole | undefined {
  return queryOne<SelfRole>('SELECT * FROM self_roles WHERE guild_id = ? AND role_id = ?', guildId, roleId);
}

export function countSelfRoles(guildId: string): number {
  return listSelfRoles(guildId).length;
}

export interface UpsertSelfRoleInput {
  guildId: string;
  roleId: string;
  label: string;
  labelI18n: string | null;
  emoji: string | null;
}

/**
 * Adds a role, or edits one already on the panel.
 *
 * `created_at` is left alone on conflict so that fixing a typo in a label does
 * not move the button to the end of the panel.
 */
export function upsertSelfRole(input: UpsertSelfRoleInput): void {
  db.prepare(
    `INSERT INTO self_roles (guild_id, role_id, label, label_i18n, emoji, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, role_id) DO UPDATE SET
       label      = excluded.label,
       label_i18n = excluded.label_i18n,
       emoji      = excluded.emoji`,
  ).run(input.guildId, input.roleId, input.label, input.labelI18n, input.emoji, Date.now());
}

/** Returns false when the role was not on the panel to begin with. */
export function removeSelfRole(guildId: string, roleId: string): boolean {
  const { changes } = db
    .prepare('DELETE FROM self_roles WHERE guild_id = ? AND role_id = ?')
    .run(guildId, roleId);
  return Number(changes) > 0;
}
