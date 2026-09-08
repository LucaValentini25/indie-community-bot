import {
  ButtonBuilder,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Role,
} from 'discord.js';
import {
  MAX_SELF_ROLES,
  assignabilityProblem,
  buildSelfRolePanel,
  describeAssignability,
  labelFor,
} from '../../features/selfroles/index.js';
import {
  countSelfRoles,
  listSelfRoles,
  removeSelfRole,
  selfRoleFor,
  upsertSelfRole,
} from '../../features/selfroles/repository.js';
import {
  brandedEmbed,
  contextForUser,
  describeChannelFailure,
  publicLocales,
  resolveSendableChannel,
} from '../../lib/context.js';
import type { Command } from '../../core/types.js';

/**
 * Self-assignable roles: the opt-in half of role management.
 *
 * `/config roles` sets the roles the *bot* uses (auto-role on join, who gets
 * pinged for a build, who counts as staff). This sets the roles *members* hand
 * themselves. Same word, opposite direction, so they stay separate commands.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('selfrole')
    .setDescription('Roles members can give themselves from a button panel')
    .setDescriptionLocalizations({ 'es-ES': 'Roles que los miembros pueden darse solos con botones' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a role to the panel, or edit one already on it')
        .setDescriptionLocalizations({ 'es-ES': 'Agregar un rol al panel, o editar uno que ya está' })
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('The role members may give themselves')
            .setDescriptionLocalizations({ 'es-ES': 'El rol que los miembros pueden darse' })
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('label')
            .setDescription('What the button says, in the main language')
            .setDescriptionLocalizations({ 'es-ES': 'Lo que dice el botón, en el idioma principal' })
            .setRequired(true)
            .setMaxLength(64),
        )
        .addStringOption((option) =>
          option
            .setName('emoji')
            .setDescription('Optional emoji for the button')
            .setDescriptionLocalizations({ 'es-ES': 'Emoji opcional para el botón' })
            .setMaxLength(64),
        )
        .addStringOption((option) =>
          option
            .setName('label_en')
            .setDescription('Label in English. Overrides label for the English copy.')
            .setMaxLength(64),
        )
        .addStringOption((option) =>
          option
            .setName('label_es')
            .setDescription('Etiqueta en español. Reemplaza a label en el texto en español.')
            .setMaxLength(64),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Take a role off the panel')
        .setDescriptionLocalizations({ 'es-ES': 'Sacar un rol del panel' })
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('The role to remove')
            .setDescriptionLocalizations({ 'es-ES': 'El rol a sacar' })
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Show the roles on the panel and whether I can assign them')
        .setDescriptionLocalizations({ 'es-ES': 'Ver los roles del panel y si puedo asignarlos' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Post the role panel')
        .setDescriptionLocalizations({ 'es-ES': 'Publicar el panel de roles' })
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Where to post it (defaults to this channel)')
            .setDescriptionLocalizations({ 'es-ES': 'Dónde publicarlo (por defecto, este canal)' })
            .addChannelTypes(ChannelType.GuildText),
        ),
    ),

  async execute(interaction) {
    const guild = interaction.guild!;
    const { config, s } = contextForUser(guild.id, interaction.locale);

    switch (interaction.options.getSubcommand()) {
      case 'add': {
        const role = interaction.options.getRole('role', true) as Role;

        // Fail here rather than at click time. A panel that looks fine and
        // silently does nothing is the classic way these break.
        const problem = assignabilityProblem(guild, role);
        if (problem) {
          await interaction.reply({
            content: describeAssignability(problem, role, s),
            allowedMentions: { parse: [] },
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const isNew = !selfRoleFor(guild.id, role.id);
        if (isNew && countSelfRoles(guild.id) >= MAX_SELF_ROLES) {
          await interaction.reply({
            content: s('selfrole.full', { max: MAX_SELF_ROLES }),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const emoji = interaction.options.getString('emoji')?.trim() || null;
        if (emoji && !isUsableEmoji(emoji)) {
          await interaction.reply({
            content: s('selfrole.invalidEmoji', { emoji }),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        upsertSelfRole({
          guildId: guild.id,
          roleId: role.id,
          label: interaction.options.getString('label', true),
          labelI18n: labelsByLocale(interaction),
          emoji,
        });

        await interaction.reply({
          content: `✅ ${s(isNew ? 'selfrole.addedRule' : 'selfrole.updatedRule', {
            role: `<@&${role.id}>`,
          })}\n${s('selfrole.repostReminder')}`,
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'remove': {
        const role = interaction.options.getRole('role', true);
        const removed = removeSelfRole(guild.id, role.id);

        await interaction.reply({
          content: removed
            ? `✅ ${s('selfrole.removedRule', { role: `<@&${role.id}>` })}\n${s('selfrole.repostReminder')}`
            : s('selfrole.notInList', { role: `<@&${role.id}>` }),
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'list': {
        const roles = listSelfRoles(guild.id);
        const locales = publicLocales(config);

        const embed = brandedEmbed(config).setTitle(s('selfrole.listTitle'));

        if (roles.length === 0) {
          embed.setDescription(s('selfrole.listEmpty'));
        } else {
          // Re-checks assignability per row, so `/selfrole list` doubles as the
          // "why is the panel not working" diagnostic.
          const lines = roles.map((entry) => {
            const role = guild.roles.cache.get(entry.role_id);
            if (!role) return `🔴 <@&${entry.role_id}> — ${s('selfrole.roleGone')}`;

            const problem = assignabilityProblem(guild, role);
            const label = labelFor(entry, locales);
            return problem
              ? `🔴 **${label}** — ${describeAssignability(problem, role, s)}`
              : `🟢 **${label}** — <@&${role.id}>`;
          });

          embed.setDescription(
            `${s('selfrole.listCount', { count: roles.length, max: MAX_SELF_ROLES })}\n\n${lines.join('\n')}`,
          );
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      case 'panel': {
        const panel = buildSelfRolePanel(guild, config);
        if (!panel) {
          await interaction.reply({ content: s('selfrole.panelEmpty'), flags: MessageFlags.Ephemeral });
          return;
        }

        const target = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
        const lookup = await resolveSendableChannel(guild, target);

        if (!lookup.ok) {
          await interaction.reply({
            content: describeChannelFailure(lookup, s),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await lookup.channel.send({ ...panel, allowedMentions: { parse: [] } });
        await interaction.reply({
          content: s('selfrole.panelPosted', { channel: `<#${lookup.channel.id}>` }),
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};

/** The per-locale labels supplied, in the same shape as `builds.notes_i18n`. */
function labelsByLocale(interaction: ChatInputCommandInteraction): string | null {
  const labels: Record<string, string> = {};
  const en = interaction.options.getString('label_en');
  const es = interaction.options.getString('label_es');
  if (en) labels.en = en;
  if (es) labels.es = es;
  return Object.keys(labels).length > 0 ? JSON.stringify(labels) : null;
}

/**
 * Whether Discord will accept this on a button.
 *
 * `setEmoji` parses unicode and the `<:name:id>` / `<a:name:id>` custom forms
 * and throws on anything else. Catching it here turns "the panel silently fails
 * to post later" into an error on the command that caused it.
 */
function isUsableEmoji(emoji: string): boolean {
  try {
    new ButtonBuilder().setEmoji(emoji);
    return true;
  } catch {
    return false;
  }
}

export default command;
