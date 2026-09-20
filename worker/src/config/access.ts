import { has, Perm } from '../discord/permissions.js';
import type { InteractionMember } from '../discord/interaction.js';
import { memo, type App } from '../types.js';

/**
 * Per-guild role gating for commands. Same rules as the always-on bot: rules
 * only ever narrow what Discord's own default permissions allow, a command's
 * own list overrides the `*` list, and Administrators always pass.
 */

/** Stands in for "every command" in the `command` column. */
export const ANY_COMMAND = '*';

/** Command name → the roles allowed to run it. Empty map means no rules. */
export type AccessRules = ReadonlyMap<string, ReadonlySet<string>>;

interface AccessRow {
  command: string;
  role_id: string;
}

export function accessRules(app: App, guildId: string): Promise<Map<string, Set<string>>> {
  return memo(app, `access:${guildId}`, async () => {
    const rules = new Map<string, Set<string>>();
    const rows = await app.db.all<AccessRow>(
      'SELECT command, role_id FROM command_access WHERE guild_id = ?',
      guildId,
    );

    for (const row of rows) {
      let roles = rules.get(row.command);
      if (!roles) {
        roles = new Set();
        rules.set(row.command, roles);
      }
      roles.add(row.role_id);
    }

    return rules;
  });
}

/** A command's own list wins outright over the `*` list; it does not merge. */
export async function effectiveRoles(
  app: App,
  guildId: string,
  command: string,
): Promise<ReadonlySet<string>> {
  const rules = await accessRules(app, guildId);
  return rules.get(command) ?? rules.get(ANY_COMMAND) ?? new Set<string>();
}

export type AccessDecision = { allowed: true } | { allowed: false; requiredRoles: readonly string[] };

/**
 * Whether `member` may run `command`.
 *
 * The server owner needs no special case here: Discord computes an owner's
 * interaction permissions as every bit, Administrator included.
 */
export async function checkCommandAccess(
  app: App,
  guildId: string,
  member: InteractionMember | null,
  command: string,
): Promise<AccessDecision> {
  if (!member) return { allowed: false, requiredRoles: [] };
  if (has(member.permissions, Perm.Administrator)) return { allowed: true };

  const required = await effectiveRoles(app, guildId, command);
  if (required.size === 0) return { allowed: true };

  for (const roleId of required) {
    if (member.roles.includes(roleId)) return { allowed: true };
  }

  return { allowed: false, requiredRoles: [...required] };
}

/** Grants a role. Returns false if the rule already existed. */
export async function allowRole(
  app: App,
  guildId: string,
  command: string,
  roleId: string,
): Promise<boolean> {
  const changes = await app.db.run(
    `INSERT INTO command_access (guild_id, command, role_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id, command, role_id) DO NOTHING`,
    guildId,
    command,
    roleId,
    Date.now(),
  );
  app.memo.delete(`access:${guildId}`);
  return changes > 0;
}

/** Revokes a role. Returns false if there was no such rule. */
export async function revokeRole(
  app: App,
  guildId: string,
  command: string,
  roleId: string,
): Promise<boolean> {
  const changes = await app.db.run(
    'DELETE FROM command_access WHERE guild_id = ? AND command = ? AND role_id = ?',
    guildId,
    command,
    roleId,
  );
  app.memo.delete(`access:${guildId}`);
  return changes > 0;
}

/** Drops every rule for one command, sending it back to the fallback. */
export async function clearCommand(app: App, guildId: string, command: string): Promise<number> {
  const changes = await app.db.run(
    'DELETE FROM command_access WHERE guild_id = ? AND command = ?',
    guildId,
    command,
  );
  app.memo.delete(`access:${guildId}`);
  return changes;
}
