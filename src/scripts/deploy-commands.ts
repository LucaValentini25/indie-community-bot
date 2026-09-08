import { join } from 'node:path';
import { REST, Routes } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { loadCommands } from '../core/loader.js';

const log = logger.child({ module: 'deploy-commands' });

/**
 * Registers slash commands with Discord.
 *
 * Run this after adding, renaming or changing the options of a command — the
 * bot process itself never registers anything, so a restart alone will not
 * publish a new command.
 *
 *   npm run commands:deploy         register
 *   npm run commands:clear          remove every command
 *
 * With DISCORD_DEV_GUILD_ID set, commands are scoped to that one guild and
 * appear instantly. Without it they are registered globally, which is what you
 * want in production but can take up to an hour to propagate.
 */
async function main(): Promise<void> {
  const clear = process.argv.includes('--clear');
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  const route = env.DISCORD_DEV_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

  const scope = env.DISCORD_DEV_GUILD_ID ? `guild ${env.DISCORD_DEV_GUILD_ID}` : 'global';

  if (clear) {
    await rest.put(route, { body: [] });
    log.info({ scope }, 'cleared all commands');
    return;
  }

  const commands = await loadCommands(join(import.meta.dirname, '..', 'commands'));
  const body = [...commands.values()].map((command) => command.data.toJSON());

  const result = (await rest.put(route, { body })) as unknown[];

  log.info({ scope, count: result.length, commands: [...commands.keys()] }, 'commands registered');

  if (!env.DISCORD_DEV_GUILD_ID) {
    log.info('global commands can take up to an hour to appear in every server');
  }
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'failed to deploy commands');
  process.exit(1);
});
