import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
} from 'discord.js';
import {
  ANY_COMMAND,
  accessRules,
  allowRole,
  clearCommand,
  revokeRole,
  type AccessRules,
} from '../../config/access.js';
import { brandedEmbed, contextForUser } from '../../lib/context.js';
import type { BotClient } from '../../core/client.js';
import type { Command } from '../../core/types.js';
import type { GuildConfig } from '../../config/guild.js';
import type { Translate } from '../../i18n/index.js';

/**
 * `/access` is deliberately its own command rather than another `/config`
 * subcommand: it must be Administrator-only, and default member permissions are
 * a property of the whole command. Under `/config` (Manage Server) anyone who
 * could configure the bot could also hand themselves the keys to it.
 *
 * For the same reason `/access` never gates itself — see ADMINISTERED below.
 */
const ADMINISTERED = 'access';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('access')
    .setDescription('Choose which roles may use the bot’s commands')
    .setDescriptionLocalizations({ 'es-ES': 'Elegir qué roles pueden usar los comandos del bot' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Show who may use what')
        .setDescriptionLocalizations({ 'es-ES': 'Ver quién puede usar qué' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('allow')
        .setDescription('Let a role use a command')
        .setDescriptionLocalizations({ 'es-ES': 'Permitir que un rol use un comando' })
        .addStringOption((option) =>
          option
            .setName('command')
            .setDescription('Which command, or "everything"')
            .setDescriptionLocalizations({ 'es-ES': 'Qué comando, o «todo»' })
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('The role to allow')
            .setDescriptionLocalizations({ 'es-ES': 'El rol a permitir' })
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('revoke')
        .setDescription('Stop a role from using a command')
        .setDescriptionLocalizations({ 'es-ES': 'Quitarle a un rol el uso de un comando' })
        .addStringOption((option) =>
          option
            .setName('command')
            .setDescription('Which command, or "everything"')
            .setDescriptionLocalizations({ 'es-ES': 'Qué comando, o «todo»' })
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('The role to revoke')
            .setDescriptionLocalizations({ 'es-ES': 'El rol a revocar' })
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Remove every rule for a command')
        .setDescriptionLocalizations({ 'es-ES': 'Borrar todas las reglas de un comando' })
        .addStringOption((option) =>
          option
            .setName('command')
            .setDescription('Which command, or "everything"')
            .setDescriptionLocalizations({ 'es-ES': 'Qué comando, o «todo»' })
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async autocomplete(interaction) {
    // Sourced from the loaded registry rather than a hardcoded list of choices,
    // so a new file in src/commands/ shows up here with nothing to update.
    const { s } = contextForUser(interaction.guildId!, interaction.locale);
    const typed = interaction.options.getFocused().toLowerCase().replace(/^\//, '');

    const choices = [
      { name: s('access.everyCommand'), value: ANY_COMMAND },
      ...gateableCommands(interaction.client as BotClient).map((name) => ({
        name: `/${name}`,
        value: name,
      })),
    ];

    await interaction.respond(
      choices
        .filter(({ name, value }) => value.includes(typed) || name.toLowerCase().includes(typed))
        .slice(0, 25),
    );
  },

  async execute(interaction) {
    const guild = interaction.guild!;
    // Always an ephemeral reply, so it speaks the admin's own language.
    const { config, s } = contextForUser(guild.id, interaction.locale);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'show') {
      await interaction.reply({
        embeds: [rulesEmbed(guild, config, s)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = normalizeTarget(interaction.options.getString('command', true));
    const known = gateableCommands(interaction.client as BotClient);

    if (target === ADMINISTERED) {
      await interaction.reply({ content: s('access.selfLocked'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (target !== ANY_COMMAND && !known.includes(target)) {
      await interaction.reply({
        content: s('access.unknownCommand', { command: target }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const label = commandLabel(target, s);

    if (subcommand === 'clear') {
      const removed = clearCommand(guild.id, target);
      await interaction.reply({
        content:
          removed === 0
            ? s('access.nothingToClear', { command: label })
            : `✅ ${s('access.cleared', { count: removed, command: label })}`,
        embeds: removed === 0 ? [] : [rulesEmbed(guild, config, s)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.options.getRole('role', true);

    if (subcommand === 'allow') {
      // A command's own list overrides the "everything" list rather than adding
      // to it, so the first rule on a command can silently lock out roles that
      // were covered by the wildcard. Say so instead of letting them find out.
      const hadOwnList = accessRules(guild.id).has(target);
      const added = allowRole(guild.id, target, role.id);

      const notes = [
        added
          ? `✅ ${s('access.allowed', { role: `<@&${role.id}>`, command: label })}`
          : s('access.alreadyAllowed', { role: `<@&${role.id}>`, command: label }),
      ];

      if (added && !hadOwnList && target !== ANY_COMMAND && accessRules(guild.id).has(ANY_COMMAND)) {
        notes.push(s('access.overridesWildcard', { command: label }));
      }

      await interaction.reply({
        content: notes.join('\n'),
        embeds: [rulesEmbed(guild, config, s)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'revoke') {
      const removed = revokeRole(guild.id, target, role.id);
      await interaction.reply({
        content: removed
          ? `✅ ${s('access.revoked', { role: `<@&${role.id}>`, command: label })}`
          : s('access.notAllowed', { role: `<@&${role.id}>`, command: label }),
        embeds: removed ? [rulesEmbed(guild, config, s)] : [],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

/**
 * The option is free text with autocomplete, not a fixed choice list, so a
 * value can arrive typed rather than picked. Accept what the picker *shows*
 * (`/build`) and the obvious words for the wildcard, so the documented examples
 * work whether or not the person used the dropdown.
 */
const WILDCARD_ALIASES = new Set([
  'everything',
  'every command',
  'all',
  'todo',
  'todos',
  'todos los comandos',
]);

function normalizeTarget(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^\//, '');
  return WILDCARD_ALIASES.has(value) ? ANY_COMMAND : value;
}

/** Every command a rule may name — all of them except `/access` itself. */
function gateableCommands(client: BotClient): string[] {
  return [...client.commands.keys()].filter((name) => name !== ADMINISTERED).sort();
}

function commandLabel(command: string, s: Translate): string {
  return command === ANY_COMMAND ? s('access.everyCommand') : `/${command}`;
}

function rulesEmbed(guild: Guild, config: GuildConfig, s: Translate) {
  const rules: AccessRules = accessRules(guild.id);
  const embed = brandedEmbed(config)
    .setTitle(s('access.title'))
    .setFooter({ text: s('access.footer') });

  if (rules.size === 0) {
    return embed.setDescription(
      `${s('access.description', { guild: guild.name })}\n\n${s('access.noRules')}`,
    );
  }

  const wildcard = rules.get(ANY_COMMAND);
  const lines: string[] = [];

  // The wildcard first: it is the baseline every other line is read against.
  if (wildcard) {
    lines.push(`**${s('access.everyCommand')}** — ${roleList(wildcard, s)}`);
  }

  for (const [command, roles] of [...rules].sort(([a], [b]) => a.localeCompare(b))) {
    if (command === ANY_COMMAND) continue;
    lines.push(`**/${command}** — ${roleList(roles, s)}`);
  }

  if (!wildcard) lines.push(`**${s('access.everythingElse')}** — ${s('access.discordDefault')}`);

  return embed.setDescription(`${s('access.description', { guild: guild.name })}\n\n${lines.join('\n')}`);
}

function roleList(roles: ReadonlySet<string>, s: Translate): string {
  if (roles.size === 0) return s('common.none');
  return [...roles].map((id) => `<@&${id}>`).join(', ');
}

export default command;
