import { ActionRowBuilder, ButtonBuilder, type EmbedBuilder } from '@discordjs/builders';
import { ButtonStyle, type APIRole } from 'discord-api-types/v10';
import {
  brandedEmbed,
  contextForUser,
  getBotMember,
  getGuildRoles,
  localeRenderers,
} from '../lib/context.js';
import { createLogger } from '../logger.js';
import { parseEmoji } from '../lib/discord.js';
import { truncate } from '../../../src/lib/text.js';
import { isLocale, type Locale, type Translate } from '../../../src/i18n/index.js';
import { channelPermissions, has, highestRolePosition, Perm } from '../discord/permissions.js';
import { EPHEMERAL } from '../discord/message.js';
import type { Interaction } from '../discord/interaction.js';
import type { GuildConfig } from '../config/guild.js';
import type { App } from '../types.js';

const log = createLogger('selfroles');

// ─────────────────────────────────────────────────────────────
//  Storage
// ─────────────────────────────────────────────────────────────

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

/** Panel order. Stable across label edits, by design: see the migration. */
export function listSelfRoles(app: App, guildId: string): Promise<SelfRole[]> {
  return app.db.all<SelfRole>('SELECT * FROM self_roles WHERE guild_id = ? ORDER BY created_at ASC', guildId);
}

export function selfRoleFor(app: App, guildId: string, roleId: string): Promise<SelfRole | undefined> {
  return app.db.first<SelfRole>(
    'SELECT * FROM self_roles WHERE guild_id = ? AND role_id = ?',
    guildId,
    roleId,
  );
}

export async function countSelfRoles(app: App, guildId: string): Promise<number> {
  return (await listSelfRoles(app, guildId)).length;
}

/**
 * Adds a role, or edits one already on the panel. `created_at` is left alone on
 * conflict so fixing a typo in a label does not move the button to the end.
 */
export async function upsertSelfRole(
  app: App,
  input: { guildId: string; roleId: string; label: string; labelI18n: string | null; emoji: string | null },
): Promise<void> {
  await app.db.run(
    `INSERT INTO self_roles (guild_id, role_id, label, label_i18n, emoji, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, role_id) DO UPDATE SET
       label      = excluded.label,
       label_i18n = excluded.label_i18n,
       emoji      = excluded.emoji`,
    input.guildId,
    input.roleId,
    input.label,
    input.labelI18n,
    input.emoji,
    Date.now(),
  );
}

/** Returns false when the role was not on the panel to begin with. */
export async function removeSelfRole(app: App, guildId: string, roleId: string): Promise<boolean> {
  const changes = await app.db.run(
    'DELETE FROM self_roles WHERE guild_id = ? AND role_id = ?',
    guildId,
    roleId,
  );
  return changes > 0;
}

// ─────────────────────────────────────────────────────────────
//  Panel
// ─────────────────────────────────────────────────────────────

/** Five buttons per row and five rows per message: a hard ceiling, not a policy. */
export const MAX_SELF_ROLES = 25;

/** Discord's own limit on a button label. */
const MAX_LABEL = 80;

export const SelfRoleIds = {
  toggle: (roleId: string) => `selfrole:toggle:${roleId}`,
} as const;

/**
 * The label a button shows. A component has one label for every viewer, so a
 * bilingual server gets both languages joined onto it — the same compromise
 * the bug panel makes.
 */
export function labelFor(role: SelfRole, locales: Locale[]): string {
  const perLocale = parseLabels(role);
  const parts: string[] = [];

  for (const locale of locales) {
    const value = perLocale[locale] ?? role.label;
    if (!parts.includes(value)) parts.push(value);
  }

  return truncate(parts.join(' · ') || role.label, MAX_LABEL);
}

function parseLabels(role: SelfRole): Partial<Record<Locale, string>> {
  if (!role.label_i18n) return {};
  try {
    const parsed = JSON.parse(role.label_i18n) as Record<string, unknown>;
    const out: Partial<Record<Locale, string>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isLocale(key) && typeof value === 'string' && value.trim()) out[key] = value;
    }
    return out;
  } catch {
    // A malformed blob should cost a nicer label, not the whole panel.
    return {};
  }
}

/** The panel: one embed per public language, then the buttons. Null when there is nothing to show. */
export async function buildSelfRolePanel(
  app: App,
  guildId: string,
  config: GuildConfig,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } | null> {
  const existing = new Set((await getGuildRoles(app, guildId)).map((role) => role.id));

  // Capped here and not only in `/selfrole add`: past 25 the message needs a
  // sixth action row and Discord rejects the whole panel.
  const roles = (await listSelfRoles(app, guildId))
    .filter((role) => existing.has(role.role_id))
    .slice(0, MAX_SELF_ROLES);
  if (roles.length === 0) return null;

  const renderers = localeRenderers(config);
  const bilingual = renderers.length > 1;
  const locales = renderers.map((renderer) => renderer.locale);

  const embeds = renderers.map((renderer) => {
    const lines = roles.map((role) => {
      const label = parseLabels(role)[renderer.locale] ?? role.label;
      return `${role.emoji ? `${role.emoji} ` : ''}**${label}** — <@&${role.role_id}>`;
    });

    const embed = brandedEmbed(config)
      .setTitle(renderer.s('selfrole.panelTitle'))
      .setDescription(`${renderer.s('selfrole.panelDescription')}\n\n${lines.join('\n')}`);

    if (bilingual) embed.setAuthor({ name: renderer.label });
    return embed;
  });

  const buttons = roles.map((role) => {
    const button = new ButtonBuilder()
      .setCustomId(SelfRoleIds.toggle(role.role_id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(labelFor(role, locales));
    const emoji = role.emoji ? parseEmoji(role.emoji) : null;
    if (emoji) button.setEmoji(emoji);
    return button;
  });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  return { embeds, components };
}

export type AssignabilityProblem = 'everyone' | 'managed' | 'hierarchy' | 'permission';

/**
 * Why the bot cannot hand out a role, or null when it can.
 *
 * Checked both when an admin adds a role and again on every click: the role
 * hierarchy can change at any time, and finding out at click time is how these
 * panels usually fail — silently, for everyone, with no error anywhere.
 */
export async function assignabilityProblem(
  app: App,
  guildId: string,
  role: Pick<APIRole, 'id' | 'managed' | 'position'>,
): Promise<AssignabilityProblem | null> {
  if (role.id === guildId) return 'everyone';
  if (role.managed) return 'managed';

  const [roles, me] = await Promise.all([getGuildRoles(app, guildId), getBotMember(app, guildId)]);

  const permissions = channelPermissions({
    guildId,
    memberId: app.botId,
    memberRoleIds: me.roles,
    roles,
    overwrites: [],
  });
  if (!has(permissions, Perm.ManageRoles)) return 'permission';
  if (highestRolePosition(roles, me.roles) <= role.position) return 'hierarchy';

  return null;
}

/** Turns that verdict into the sentence to show. */
export function describeAssignability(problem: AssignabilityProblem, roleId: string, s: Translate): string {
  switch (problem) {
    case 'everyone':
      return s('selfrole.everyoneRole');
    case 'managed':
      return s('selfrole.managedRole', { role: `<@&${roleId}>` });
    case 'permission':
      return s('selfrole.needManageRoles');
    case 'hierarchy':
      return s('selfrole.aboveMe', { role: `<@&${roleId}>` });
  }
}

/** A click on a panel button: adds the role, or takes it away if already held. */
export async function handleSelfRoleToggle(app: App, ix: Interaction, roleId: string): Promise<void> {
  const guildId = ix.guildId;
  const member = ix.member;
  if (!guildId || !member) return;

  const { s } = await contextForUser(app, guildId, ix.locale);

  // Several API calls follow, so acknowledge first.
  await ix.deferReply({ flags: EPHEMERAL });

  // Never trust the custom id: the panel may be an old message whose roles have
  // since been removed from the list.
  const configured = await selfRoleFor(app, guildId, roleId);
  const role = configured
    ? (await getGuildRoles(app, guildId)).find((candidate) => candidate.id === roleId)
    : undefined;

  if (!configured || !role) {
    await ix.editReply({ content: s('selfrole.unavailable') });
    return;
  }

  const problem = await assignabilityProblem(app, guildId, role);
  if (problem) {
    await ix.editReply({
      content: describeAssignability(problem, roleId, s),
      allowedMentions: { parse: [] },
    });
    return;
  }

  const had = member.roles.includes(roleId);

  try {
    if (had) await app.rest.removeMemberRole(guildId, member.id, roleId, 'Self-service role panel');
    else await app.rest.addMemberRole(guildId, member.id, roleId, 'Self-service role panel');
  } catch (error) {
    log.error({ err: error, guild: guildId, role: roleId, user: member.id }, 'failed to toggle a self-role');
    await ix.editReply({ content: s('common.genericError') });
    return;
  }

  await ix.editReply({
    content: s(had ? 'selfrole.removed' : 'selfrole.added', { role: `<@&${roleId}>` }),
    // The confirmation names the role; it must not ping it.
    allowedMentions: { parse: [] },
  });
}
