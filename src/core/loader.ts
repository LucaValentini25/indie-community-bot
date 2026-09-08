import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLogger } from './logger.js';
import type { Command, EventHandler } from './types.js';

const log = createLogger('loader');

/**
 * Modules are discovered from the filesystem rather than listed in a registry.
 * Adding a command is dropping a file in `src/commands/<group>/` — there is no
 * second place to remember to update.
 *
 * `.ts` is accepted so the same loader works under tsx in development and
 * against compiled `.js` in production.
 */
const SOURCE_EXTENSIONS = new Set(['.js', '.ts']);

async function importDefaults<T>(directory: string, validate: (value: unknown) => value is T): Promise<T[]> {
  let entries: string[];
  try {
    entries = await readdir(directory, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const found: T[] = [];

  for (const entry of entries.sort()) {
    if (!SOURCE_EXTENSIONS.has(extname(entry))) continue;
    if (entry.endsWith('.d.ts')) continue;

    const fullPath = join(directory, entry);
    const module = (await import(pathToFileURL(fullPath).href)) as { default?: unknown };

    if (validate(module.default)) {
      found.push(module.default);
    } else {
      log.warn({ file: entry }, 'skipped: module has no valid default export');
    }
  }

  return found;
}

function isCommand(value: unknown): value is Command {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'execute' in value &&
    typeof (value as Command).execute === 'function'
  );
}

function isEventHandler(value: unknown): value is EventHandler {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'execute' in value &&
    typeof (value as EventHandler).execute === 'function'
  );
}

export async function loadCommands(directory: string): Promise<Map<string, Command>> {
  const commands = await importDefaults(directory, isCommand);
  const registry = new Map<string, Command>();

  for (const command of commands) {
    const name = command.data.name;
    if (registry.has(name)) {
      throw new Error(`Duplicate command name "${name}". Command names must be unique.`);
    }
    registry.set(name, command);
  }

  log.info({ count: registry.size, commands: [...registry.keys()] }, 'commands loaded');
  return registry;
}

export async function loadEvents(directory: string): Promise<EventHandler[]> {
  const events = await importDefaults(directory, isEventHandler);
  log.info({ count: events.length }, 'events loaded');
  return events;
}
