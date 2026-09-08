import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type Role,
} from 'discord.js';
import { brandedEmbed, contextForUser, localeRenderers } from '../../lib/context.js';
import { createLogger } from '../../core/logger.js';
import { truncate } from '../../lib/text.js';
import { isLocale, type Locale, type Translate } from '../../i18n/index.js';
import { listSelfRoles, selfRoleFor, type SelfRole } from './repository.js';
import type { GuildConfig } from '../../config/guild.js';

const log = createLogger('selfroles');

/**
 * Discord allows five buttons per action row and five rows per message. The
 * panel is one message, so this is a hard ceiling rather than a policy choice.
 */
export const MAX_SELF_ROLES = 25;

/** Discord's own limit on a button label. */
const MAX_LABEL = 80;

export const SelfRoleIds = {
  toggle: (roleId: string) => `selfrole:toggle:${roleId}`,
} as const;

/**
 * The label a button shows.
 *
 * A component has one label for every viewer, so a bilingual server gets both
 * languages joined onto it — the same compromise the bug panel makes. When the
 * per-locale copy is missing we fall back to the single `label`, and identical
 * strings collapse rather than being printed twice.
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

/**
 * The panel: one embed per public language, then the buttons.
 *
 * The embed lists each role as a mention next to its label, because a button
 * alone does not tell you which role you are about to get — and in a server
 * with a @Playtester and a @Playtest Alumni that difference matters.
 */
export function buildSelfRolePanel(
  guild: Guild,
  config: GuildConfig,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } | null {
  // Capped here and not only in `/selfrole add`: past 25 the message needs a
  // sixth action row and Discord rejects it outright, so the whole panel would
  // fail to post rather than posting short.
  const roles = listSelfRoles(guild.id)
    .filter((role) => guild.roles.cache.has(role.role_id))
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
    if (role.emoji) button.setEmoji(role.emoji);
    return button;
  });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  return { embeds, components };
}

/**
 * Why the bot cannot hand out a role, or null when it can.
 *
 * Checked both when an admin adds a role and again on every click: the role
 * hierarchy can change at any time, and finding out at click time is how these
 * panels usually fail — silently, for everyone, with no error anywhere.
 */
export function assignabilityProblem(
  guild: Guild,
  role: Role,
): 'everyone' | 'managed' | 'hierarchy' | 'permission' | null {
  if (role.id === guild.id) return 'everyone';
  if (role.managed) return 'managed';

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'permission';
  if (me.roles.highest.comparePositionTo(role) <= 0) return 'hierarchy';

  return null;
}

/** Turns that verdict into the sentence to show. */
export function describeAssignability(
  problem: Exclude<ReturnType<typeof assignabilityProblem>, null>,
  role: Role,
  s: Translate,
): string {
  switch (problem) {
    case 'everyone':
      return s('selfrole.everyoneRole');
    case 'managed':
      return s('selfrole.managedRole', { role: `<@&${role.id}>` });
    case 'permission':
      return s('selfrole.needManageRoles');
    case 'hierarchy':
      return s('selfrole.aboveMe', { role: `<@&${role.id}>` });
  }
}

/** A click on a panel button: adds the role, or takes it away if already held. */
export async function handleSelfRoleToggle(interaction: ButtonInteraction, roleId: string): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member as GuildMember | null;
  if (!guild || !member) return;

  const { s } = contextForUser(guild.id, interaction.locale);

  // Never trust the custom id: the panel may be an old message whose roles have
  // since been removed from the list.
  const configured = selfRoleFor(guild.id, roleId);
  const role = configured ? await guild.roles.fetch(roleId).catch(() => null) : null;

  if (!configured || !role) {
    await interaction.reply({ content: s('selfrole.unavailable'), flags: MessageFlags.Ephemeral });
    return;
  }

  const problem = assignabilityProblem(guild, role);
  if (problem) {
    await interaction.reply({
      content: describeAssignability(problem, role, s),
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const had = member.roles.cache.has(roleId);

  try {
    if (had) {
      await member.roles.remove(role, 'Self-service role panel');
    } else {
      await member.roles.add(role, 'Self-service role panel');
    }
  } catch (error) {
    log.error({ err: error, guild: guild.id, role: roleId, user: member.id }, 'failed to toggle a self-role');
    await interaction.reply({ content: s('common.genericError'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: s(had ? 'selfrole.removed' : 'selfrole.added', { role: `<@&${roleId}>` }),
    // The confirmation names the role; it must not ping it.
    allowedMentions: { parse: [] },
    flags: MessageFlags.Ephemeral,
  });
}
