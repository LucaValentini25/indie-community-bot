import { join } from 'node:path';
import type { Server } from 'node:http';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { createClient } from './core/client.js';
import { loadCommands, loadEvents } from './core/loader.js';
import { closeDatabase, runMigrations } from './db/index.js';
import { registerFonts } from './features/welcome/card.js';
import { startHttpServer } from './http/server.js';

const log = logger.child({ module: 'bootstrap' });

async function main(): Promise<void> {
  log.info({ env: env.NODE_ENV, node: process.version }, 'starting');

  runMigrations();
  registerFonts();

  const client = createClient();

  // `import.meta.dirname` is `src/` under tsx and `dist/` after a build, so the
  // same paths work in both without any extra configuration.
  const here = import.meta.dirname;

  for (const [name, command] of await loadCommands(join(here, 'commands'))) {
    client.commands.set(name, command);
  }

  for (const event of await loadEvents(join(here, 'events'))) {
    const handler = (...args: unknown[]) =>
      Promise.resolve((event.execute as (...a: unknown[]) => unknown)(...args)).catch((error: unknown) =>
        log.error({ err: error, event: event.name }, 'event handler threw'),
      );

    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
  }

  client.on('error', (error) => log.error({ err: error }, 'discord client error'));
  client.on('warn', (message) => log.warn({ message }, 'discord client warning'));

  const httpServer = startHttpServer(client);

  installShutdownHandlers(client, httpServer);

  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (error) {
    // By this point the port is bound and the database is open. Exiting
    // straight from the catch below would leave both to be torn down by
    // process death — which skips the WAL checkpoint and, on Windows, aborts
    // libuv with half-closed handles instead of reporting the real cause.
    // Unwind in the same order the signal handler does.
    await shutdownResources(client, httpServer);
    throw error;
  }
}

/**
 * Sets the exit code and lets the event loop finish closing what is already
 * closing, rather than calling `process.exit` on the spot.
 *
 * `process.exit` tears the process down mid-close: on Windows that aborts
 * libuv with `!(handle->flags & UV_HANDLE_CLOSING)`, which replaces whatever
 * we just logged as the real cause with a crash message. The unref'd timer is
 * the backstop — if some handle refuses to close, we still exit rather than
 * hanging a container forever, and `.unref()` keeps the timer itself from
 * being the thing that holds the loop open.
 */
function exitWhenDrained(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
}

/** Closes what `main` opened, in the order that keeps SQLite consistent. */
async function shutdownResources(client: ReturnType<typeof createClient>, httpServer: Server): Promise<void> {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await client.destroy().catch(() => undefined);
  closeDatabase();
}

function installShutdownHandlers(client: ReturnType<typeof createClient>, httpServer: Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'shutting down');

    // Stop accepting webhooks first, then disconnect the gateway cleanly so
    // Discord does not treat it as a crash, then flush SQLite's WAL.
    await shutdownResources(client, httpServer);

    log.info('bye');
    exitWhenDrained(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A rejection we failed to handle is a bug, but it must not silently kill
  // the process and take the bot offline.
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'uncaught exception — exiting so the supervisor restarts us');
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'failed to start');
  exitWhenDrained(1);
});
