import { PermissionFlagsBits, type APIOverwrite, type APIRole } from 'discord-api-types/v10';

export { PermissionFlagsBits as Perm };

/** Every bit set. What an Administrator effectively holds. */
const ALL = (1n << 64n) - 1n;

const NAMES = Object.entries(PermissionFlagsBits) as [string, bigint][];

/** `1n << 3n` -> `'Administrator'`. Used to tell an admin what is missing. */
export function permissionNames(bits: bigint): string[] {
  return NAMES.filter(([, bit]) => (bits & bit) === bit).map(([name]) => name);
}

export function has(permissions: bigint, flag: bigint): boolean {
  return (permissions & flag) === flag;
}

/** The subset of `required` that `permissions` does not grant, as readable names. */
export function missingPermissions(permissions: bigint, required: readonly bigint[]): string[] {
  return required.filter((flag) => !has(permissions, flag)).flatMap((flag) => permissionNames(flag));
}

/**
 * A member's permissions in a channel, using Discord's documented algorithm:
 * base from @everyone and their roles, Administrator short-circuits, then the
 * channel's @everyone overwrite, then role overwrites, then the member's own.
 *
 * Interactions carry this already, but only for the channel the command ran
 * in. The bot has to answer the same question about *other* channels — the
 * one it is about to post an announcement in — so it computes it itself.
 */
export function channelPermissions(input: {
  guildId: string;
  memberId: string;
  memberRoleIds: readonly string[];
  roles: readonly APIRole[];
  overwrites: readonly APIOverwrite[];
}): bigint {
  const { guildId, memberId, memberRoleIds, roles, overwrites } = input;

  // The @everyone role shares the guild's id.
  let permissions = BigInt(roles.find((role) => role.id === guildId)?.permissions ?? '0');
  for (const role of roles) {
    if (memberRoleIds.includes(role.id)) permissions |= BigInt(role.permissions);
  }

  if (has(permissions, PermissionFlagsBits.Administrator)) return ALL;

  const everyone = overwrites.find((overwrite) => overwrite.id === guildId);
  if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);

  let allow = 0n;
  let deny = 0n;
  for (const overwrite of overwrites) {
    // type 0 = role overwrite.
    if (overwrite.type === 0 && memberRoleIds.includes(overwrite.id)) {
      allow |= BigInt(overwrite.allow);
      deny |= BigInt(overwrite.deny);
    }
  }
  permissions = (permissions & ~deny) | allow;

  // type 1 = member overwrite.
  const own = overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === memberId);
  if (own) permissions = (permissions & ~BigInt(own.deny)) | BigInt(own.allow);

  return permissions;
}

/** Position of the highest role a member holds; @everyone counts as 0. */
export function highestRolePosition(roles: readonly APIRole[], memberRoleIds: readonly string[]): number {
  return roles.reduce(
    (highest, role) => (memberRoleIds.includes(role.id) ? Math.max(highest, role.position) : highest),
    0,
  );
}
