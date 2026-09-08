import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { db, queryAll } from '../db/index.js';

/**
 * Per-guild role gating for commands.
 *
 * Discord already hides a command from anyone without the permissions it was
 * registered with (`setDefaultMemberPermissions`). That is a blunt instrument:
 * "Manage Messages" is one bit shared with a dozen unrelated abilities, so a
 * trusted-but-not-staff member either gets all of the bot or none of it.
 *
 * These rules sit on top of it and **narrow** it: a server names the exact
 * roles allowed to run a command. They cannot widen anything — Discord will not
 * even show the command to someone who fails its default permission — so a
 * server that wants to open a command up more broadly has to do that in
 * Server Settings → Integrations, and can then narrow it back here.
 */

/** Stands in for "every command" in the `command` column. */
export const ANY_COMMAND = '*';

/** Command name → the roles allowed to run it. Empty map means no rules. */
export type AccessRules = ReadonlyMap<string, ReadonlySet<string>>;

interface AccessRow {
  command: string;
  role_id: string;
}

/**
 * Same reasoning as the guild config cache: this is read on every command, the
 * process is the only writer, and every write below drops the entry.
 */
const cache = new Map<string, Map<string, Set<string>>>();

function rulesFor(guildId: string): Map<string, Set<string>> {
  const cached = cache.get(guildId);
  if (cached) return cached;

  const rules = new Map<string, Set<string>>();

  for (const row of queryAll<AccessRow>(
    'SELECT command, role_id FROM command_access WHERE guild_id = ?',
    guildId,
  )) {
    let roles = rules.get(row.command);
    if (!roles) {
      roles = new Set();
      rules.set(row.command, roles);
    }
    roles.add(row.role_id);
  }

  cache.set(guildId, rules);
  return rules;
}

/** Every rule in the guild, for display. */
export function accessRules(guildId: string): AccessRules {
  return rulesFor(guildId);
}

/**
 * The roles that actually decide a command, following the specificity rule:
 * a command's own list wins outright over the `*` list. Overriding rather than
 * merging is what makes "staff can use everything, but only @Release may ship a
 * build" expressible at all.
 */
export function effectiveRoles(guildId: string, command: string): ReadonlySet<string> {
  const rules = rulesFor(guildId);
  return rules.get(command) ?? rules.get(ANY_COMMAND) ?? new Set<string>();
}

export type AccessDecision = { allowed: true } | { allowed: false; requiredRoles: readonly string[] };

/**
 * Whether `member` may run `command`.
 *
 * Administrators and the server owner always pass. Without that, one mistyped
 * `/access allow` would lock the server out of its own bot with no way back in.
 */
export function checkCommandAccess(member: GuildMember | null, command: string): AccessDecision {
  if (!member) return { allowed: false, requiredRoles: [] };

  if (member.id === member.guild.ownerId) return { allowed: true };
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return { allowed: true };

  const required = effectiveRoles(member.guild.id, command);
  if (required.size === 0) return { allowed: true };

  for (const roleId of required) {
    if (member.roles.cache.has(roleId)) return { allowed: true };
  }

  return { allowed: false, requiredRoles: [...required] };
}

/** Grants a role. Returns false if the rule already existed. */
export function allowRole(guildId: string, command: string, roleId: string): boolean {
  const { changes } = db
    .prepare(
      `INSERT INTO command_access (guild_id, command, role_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id, command, role_id) DO NOTHING`,
    )
    .run(guildId, command, roleId, Date.now());

  cache.delete(guildId);
  return Number(changes) > 0;
}

/** Revokes a role. Returns false if there was no such rule. */
export function revokeRole(guildId: string, command: string, roleId: string): boolean {
  const { changes } = db
    .prepare('DELETE FROM command_access WHERE guild_id = ? AND command = ? AND role_id = ?')
    .run(guildId, command, roleId);

  cache.delete(guildId);
  return Number(changes) > 0;
}

/** Drops every rule for one command, sending it back to the fallback. */
export function clearCommand(guildId: string, command: string): number {
  const { changes } = db
    .prepare('DELETE FROM command_access WHERE guild_id = ? AND command = ?')
    .run(guildId, command);

  cache.delete(guildId);
  return Number(changes);
}

/**
 * Drops every rule mentioning a role.
 *
 * Called when the role is deleted in Discord. Without this a deleted role
 * leaves rules nobody can satisfy, which reads as "the bot stopped working"
 * for everyone below Administrator.
 */
export function forgetRole(guildId: string, roleId: string): number {
  const { changes } = db
    .prepare('DELETE FROM command_access WHERE guild_id = ? AND role_id = ?')
    .run(guildId, roleId);

  cache.delete(guildId);
  return Number(changes);
}
