import { ANY_COMMAND, accessRules, allowRole, clearCommand, revokeRole } from '../config/access.js';
import type { GuildConfig } from '../config/guild.js';
import { brandedEmbed, contextForUser, getGuildInfo } from '../lib/context.js';
import { EPHEMERAL } from '../discord/message.js';
import type { Translate } from '../../../src/i18n/index.js';
import type { App } from '../types.js';
import type { WorkerCommand } from './types.js';

/**
 * `/access` never gates itself: it must stay Administrator-only, and a rule
 * that could lock the admin out of the command that edits the rules is a bug
 * waiting to happen. See the always-on bot's version for the full reasoning.
 */
const ADMINISTERED = 'access';

/**
 * The option is free text with autocomplete, not a fixed choice list, so a
 * value can arrive typed rather than picked. Accept what the picker *shows*
 * (`/build`) and the obvious words for the wildcard.
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
function gateableCommands(app: App): string[] {
  return app.commandNames.filter((name) => name !== ADMINISTERED).sort();
}

function commandLabel(command: string, s: Translate): string {
  return command === ANY_COMMAND ? s('access.everyCommand') : `/${command}`;
}

export const access: WorkerCommand = {
  async autocomplete(app, ix) {
    const { s } = await contextForUser(app, ix.guildId!, ix.locale);
    const typed = ix.options.getFocused().toLowerCase().replace(/^\//, '');

    const choices = [
      { name: s('access.everyCommand'), value: ANY_COMMAND },
      ...gateableCommands(app).map((name) => ({ name: `/${name}`, value: name })),
    ];

    await ix.respond(
      choices
        .filter(({ name, value }) => value.includes(typed) || name.toLowerCase().includes(typed))
        .slice(0, 25),
    );
  },

  async execute(app, ix) {
    const guildId = ix.guildId!;
    // Always an ephemeral reply, so it speaks the admin's own language.
    const { config, s } = await contextForUser(app, guildId, ix.locale);
    const subcommand = ix.options.subcommand;

    // Reading the server's name is an API call; acknowledge before making it.
    await ix.deferReply({ flags: EPHEMERAL });

    if (subcommand === 'show') {
      await ix.editReply({ embeds: [await rulesEmbed(app, guildId, config, s)] });
      return;
    }

    const target = normalizeTarget(ix.options.getString('command', true));

    if (target === ADMINISTERED) {
      await ix.editReply({ content: s('access.selfLocked') });
      return;
    }

    if (target !== ANY_COMMAND && !gateableCommands(app).includes(target)) {
      await ix.editReply({ content: s('access.unknownCommand', { command: target }) });
      return;
    }

    const label = commandLabel(target, s);

    if (subcommand === 'clear') {
      const removed = await clearCommand(app, guildId, target);
      await ix.editReply({
        content:
          removed === 0
            ? s('access.nothingToClear', { command: label })
            : `✅ ${s('access.cleared', { count: removed, command: label })}`,
        embeds: removed === 0 ? [] : [await rulesEmbed(app, guildId, config, s)],
      });
      return;
    }

    const role = ix.options.getRole('role', true);
    const mention = `<@&${role.id}>`;

    if (subcommand === 'allow') {
      // A command's own list overrides the "everything" list rather than adding
      // to it, so the first rule on a command can silently lock out roles that
      // were covered by the wildcard. Say so instead of letting them find out.
      const hadOwnList = (await accessRules(app, guildId)).has(target);
      const added = await allowRole(app, guildId, target, role.id);

      const notes = [
        added
          ? `✅ ${s('access.allowed', { role: mention, command: label })}`
          : s('access.alreadyAllowed', { role: mention, command: label }),
      ];

      if (
        added &&
        !hadOwnList &&
        target !== ANY_COMMAND &&
        (await accessRules(app, guildId)).has(ANY_COMMAND)
      ) {
        notes.push(s('access.overridesWildcard', { command: label }));
      }

      await ix.editReply({
        content: notes.join('\n'),
        embeds: [await rulesEmbed(app, guildId, config, s)],
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (subcommand === 'revoke') {
      const removed = await revokeRole(app, guildId, target, role.id);
      await ix.editReply({
        content: removed
          ? `✅ ${s('access.revoked', { role: mention, command: label })}`
          : s('access.notAllowed', { role: mention, command: label }),
        embeds: removed ? [await rulesEmbed(app, guildId, config, s)] : [],
        allowedMentions: { parse: [] },
      });
    }
  },
};

async function rulesEmbed(app: App, guildId: string, config: GuildConfig, s: Translate) {
  const rules = await accessRules(app, guildId);
  const guild = await getGuildInfo(app, guildId);
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
  if (wildcard) lines.push(`**${s('access.everyCommand')}** — ${roleList(wildcard, s)}`);

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
