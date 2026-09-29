import { checkCommandAccess } from './config/access.js';
import { access } from './commands/access.js';
import { bug } from './commands/bug.js';
import { build } from './commands/build.js';
import { announce, devlog } from './commands/community.js';
import { config } from './commands/config.js';
import { selfrole } from './commands/selfrole.js';
import { welcome } from './commands/welcome.js';
import type { WorkerCommand } from './commands/types.js';
import { EPHEMERAL } from './discord/message.js';
import { DiscordApiError } from './discord/rest.js';
import type { Interaction } from './discord/interaction.js';
import { handlePostModal, isPostModal } from './features/posts.js';
import { handleSelfRoleToggle } from './features/selfroles.js';
import {
  TicketIds,
  handleClaim,
  handleCloseRequest,
  handleReopen,
  handleReportSubmit,
  handleResolve,
  showReportModal,
} from './features/tickets.js';
import { contextForUser } from './lib/context.js';
import { createLogger } from './logger.js';
import type { App } from './types.js';

const log = createLogger('interactions');

/**
 * Every command the Worker can run, keyed by the name it is registered under.
 * Adding one means adding a file in `commands/` and a line here — and the
 * definition in `src/commands/`, which is what Discord shows in the picker.
 */
const commands: Record<string, WorkerCommand> = {
  access,
  announce,
  bug,
  build,
  config,
  devlog,
  selfrole,
  welcome,
};

export const commandNames: readonly string[] = Object.keys(commands);

const COMPONENT_BUTTON = 2;
const COMPONENT_STRING_SELECT = 3;

/**
 * Single entry point for every interaction. Handlers may throw freely: this
 * catches, logs with context, and shows one generic message rather than leaving
 * the interaction hanging as "application did not respond".
 *
 * It is also the one place the per-guild role gate is enforced, so a command
 * cannot forget to check it.
 */
export async function routeInteraction(app: App, ix: Interaction): Promise<void> {
  try {
    await dispatch(app, ix);

    // A handler that returned without answering would leave Discord waiting.
    if (!ix.responded) {
      log.warn(
        { type: ix.raw.type, customId: ix.customId, command: ix.commandName },
        'handler did not respond',
      );
      await ix.reply({ content: 'Something went wrong.', flags: EPHEMERAL });
    }
  } catch (error) {
    log.error(
      {
        err: error,
        guild: ix.guildId,
        user: ix.user.id,
        type: ix.raw.type,
        customId: ix.customId || undefined,
        command: ix.commandName || undefined,
      },
      'interaction handler threw',
    );
    await replyWithError(app, ix, error);
  }
}

async function dispatch(app: App, ix: Interaction): Promise<void> {
  const guildId = ix.guildId;

  // Everything below needs a guild: this bot has no DM surface.
  if (!guildId) {
    if (ix.isAutocomplete) await ix.respond([]);
    else await ix.reply({ content: 'This bot only works inside a server.', flags: EPHEMERAL });
    return;
  }

  if (ix.isAutocomplete) {
    // Gated as well as the command itself: suggestions are drawn from the
    // guild's own data, so they should not be readable by someone who is not
    // allowed to run the command they belong to.
    const decision = await checkCommandAccess(app, guildId, ix.member, ix.commandName);
    if (!decision.allowed) {
      await ix.respond([]);
      return;
    }

    const command = commands[ix.commandName];
    if (command?.autocomplete) await command.autocomplete(app, ix);
    else await ix.respond([]);
    return;
  }

  if (ix.isCommand) {
    const command = commands[ix.commandName];

    if (!command) {
      log.warn({ command: ix.commandName }, 'received an unknown command');
      await ix.reply({
        content: 'That command no longer exists. Try re-inviting the bot.',
        flags: EPHEMERAL,
      });
      return;
    }

    const decision = await checkCommandAccess(app, guildId, ix.member, ix.commandName);
    if (!decision.allowed) {
      const { s } = await contextForUser(app, guildId, ix.locale);
      await ix.reply({
        content:
          decision.requiredRoles.length > 0
            ? s('access.denied', { roles: decision.requiredRoles.map((id) => `<@&${id}>`).join(', ') })
            : s('common.missingPermission'),
        // Naming the roles is the point of the message, not a ping.
        allowedMentions: { parse: [] },
        flags: EPHEMERAL,
      });
      return;
    }

    await command.execute(app, ix);
    return;
  }

  if (ix.isComponent) {
    const [feature, action, id] = ix.customId.split(':');

    if (ix.componentType === COMPONENT_BUTTON) {
      if (feature === 'selfrole' && action === 'toggle' && id) {
        await handleSelfRoleToggle(app, ix, id);
        return;
      }

      if (feature === 'ticket') {
        switch (action) {
          case 'open':
            return showReportModal(app, ix);
          case 'claim':
            return handleClaim(app, ix, Number(id));
          case 'close':
            return handleCloseRequest(app, ix, Number(id));
          case 'reopen':
            return handleReopen(app, ix, Number(id));
        }
      }
      return;
    }

    if (ix.componentType === COMPONENT_STRING_SELECT && feature === 'ticket' && action === 'resolve') {
      await handleResolve(app, ix, Number(id));
    }
    return;
  }

  if (ix.isModalSubmit) {
    if (ix.customId === TicketIds.modal) return handleReportSubmit(app, ix);
    if (isPostModal(ix.customId)) return handlePostModal(app, ix);
  }
}

/** Discord's "Unknown Guild" and "Unknown Member": the bot is not in this server. */
const NOT_IN_GUILD_CODES = new Set([10004, 10007]);

/**
 * Replies (or edits, if we already answered) with the localized error text.
 *
 * "The bot is not a member of this server" gets its own message. It is the
 * classic first-install mistake — the app was added with only the
 * `applications.commands` scope, so `/` works but every API call 404s — and
 * "something went wrong" gives nobody a way to find that out.
 */
async function replyWithError(app: App, ix: Interaction, error: unknown): Promise<void> {
  try {
    const key =
      error instanceof DiscordApiError && error.code !== undefined && NOT_IN_GUILD_CODES.has(error.code)
        ? 'common.botNotInServer'
        : 'common.genericError';

    const message = ix.guildId
      ? (await contextForUser(app, ix.guildId, ix.locale)).s(key)
      : 'Something went wrong.';

    if (ix.responded) await ix.editReply({ content: message, embeds: [], components: [] });
    else await ix.reply({ content: message, flags: EPHEMERAL });
  } catch {
    // The token expired, or the database is what failed. Nothing left to do —
    // the original error is already logged.
  }
}
