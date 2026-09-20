import {
  MAX_SELF_ROLES,
  assignabilityProblem,
  buildSelfRolePanel,
  countSelfRoles,
  describeAssignability,
  labelFor,
  listSelfRoles,
  removeSelfRole,
  selfRoleFor,
  upsertSelfRole,
} from '../features/selfroles.js';
import {
  brandedEmbed,
  contextForUser,
  describeChannelFailure,
  getGuildRoles,
  publicLocales,
  resolveSendableChannel,
} from '../lib/context.js';
import { parseEmoji } from '../lib/discord.js';
import { EPHEMERAL } from '../discord/message.js';
import type { Interaction } from '../discord/interaction.js';
import type { WorkerCommand } from './types.js';

/** The per-locale labels supplied, in the same shape as `builds.notes_i18n`. */
function labelsByLocale(ix: Interaction): string | null {
  const labels: Record<string, string> = {};
  const en = ix.options.getString('label_en');
  const es = ix.options.getString('label_es');
  if (en) labels.en = en;
  if (es) labels.es = es;
  return Object.keys(labels).length > 0 ? JSON.stringify(labels) : null;
}

/**
 * Self-assignable roles: the opt-in half of role management. `/config roles`
 * sets the roles the *bot* uses; this sets the roles *members* hand themselves.
 */
export const selfrole: WorkerCommand = {
  async execute(app, ix) {
    const guildId = ix.guildId!;
    const { config, s } = await contextForUser(app, guildId, ix.locale);

    // Every subcommand reads the role list or the bot's own roles from the API.
    await ix.deferReply({ flags: EPHEMERAL });

    switch (ix.options.subcommand) {
      case 'add': {
        const role = ix.options.getRole('role', true);

        // Fail here rather than at click time. A panel that looks fine and
        // silently does nothing is the classic way these break.
        const problem = await assignabilityProblem(app, guildId, role);
        if (problem) {
          await ix.editReply({
            content: describeAssignability(problem, role.id, s),
            allowedMentions: { parse: [] },
          });
          return;
        }

        const isNew = !(await selfRoleFor(app, guildId, role.id));
        if (isNew && (await countSelfRoles(app, guildId)) >= MAX_SELF_ROLES) {
          await ix.editReply({ content: s('selfrole.full', { max: MAX_SELF_ROLES }) });
          return;
        }

        const emoji = ix.options.getString('emoji')?.trim() || null;
        if (emoji && !parseEmoji(emoji)) {
          await ix.editReply({ content: s('selfrole.invalidEmoji', { emoji }) });
          return;
        }

        await upsertSelfRole(app, {
          guildId,
          roleId: role.id,
          label: ix.options.getString('label', true),
          labelI18n: labelsByLocale(ix),
          emoji,
        });

        await ix.editReply({
          content: `✅ ${s(isNew ? 'selfrole.addedRule' : 'selfrole.updatedRule', {
            role: `<@&${role.id}>`,
          })}\n${s('selfrole.repostReminder')}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      case 'remove': {
        const role = ix.options.getRole('role', true);
        const removed = await removeSelfRole(app, guildId, role.id);

        await ix.editReply({
          content: removed
            ? `✅ ${s('selfrole.removedRule', { role: `<@&${role.id}>` })}\n${s('selfrole.repostReminder')}`
            : s('selfrole.notInList', { role: `<@&${role.id}>` }),
          allowedMentions: { parse: [] },
        });
        return;
      }

      case 'list': {
        const entries = await listSelfRoles(app, guildId);
        const locales = publicLocales(config);
        const guildRoles = await getGuildRoles(app, guildId);

        const embed = brandedEmbed(config).setTitle(s('selfrole.listTitle'));

        if (entries.length === 0) {
          embed.setDescription(s('selfrole.listEmpty'));
        } else {
          // Re-checks assignability per row, so `/selfrole list` doubles as the
          // "why is the panel not working" diagnostic.
          const lines: string[] = [];
          for (const entry of entries) {
            const role = guildRoles.find((candidate) => candidate.id === entry.role_id);
            if (!role) {
              lines.push(`🔴 <@&${entry.role_id}> — ${s('selfrole.roleGone')}`);
              continue;
            }

            const problem = await assignabilityProblem(app, guildId, role);
            const label = labelFor(entry, locales);
            lines.push(
              problem
                ? `🔴 **${label}** — ${describeAssignability(problem, role.id, s)}`
                : `🟢 **${label}** — <@&${role.id}>`,
            );
          }

          embed.setDescription(
            `${s('selfrole.listCount', { count: entries.length, max: MAX_SELF_ROLES })}\n\n${lines.join('\n')}`,
          );
        }

        await ix.editReply({ embeds: [embed] });
        return;
      }

      case 'panel': {
        const panel = await buildSelfRolePanel(app, guildId, config);
        if (!panel) {
          await ix.editReply({ content: s('selfrole.panelEmpty') });
          return;
        }

        const target = ix.options.getChannelId('channel') ?? ix.channelId;
        const lookup = await resolveSendableChannel(app, guildId, target);

        if (!lookup.ok) {
          await ix.editReply({ content: describeChannelFailure(lookup, s) });
          return;
        }

        await app.rest.createMessage(lookup.channel.id, {
          embeds: panel.embeds.map((embed) => embed.toJSON()),
          components: panel.components?.map((row) => row.toJSON()),
          allowed_mentions: { parse: [] },
        });
        await ix.editReply({ content: s('selfrole.panelPosted', { channel: `<#${lookup.channel.id}>` }) });
      }
    }
  },
};
