import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';
import type { Command } from './types.js';

/**
 * `Client` plus the command registry, so any handler that receives an
 * interaction can reach the router through `interaction.client`.
 */
export class BotClient extends Client {
  readonly commands = new Map<string, Command>();
}

/**
 * Intents are the events Discord will send us. We ask for the minimum:
 *
 *  - Guilds        : always required (channels, roles, interactions).
 *  - GuildMembers  : PRIVILEGED. Needed for the welcome card (`guildMemberAdd`)
 *                    and for the auto-role. Enable it in the Developer Portal
 *                    under Bot → Privileged Gateway Intents.
 *
 * We deliberately do NOT request MessageContent: nothing in this bot reads
 * message text, and skipping it avoids a second privileged intent (and the
 * verification it triggers once the bot passes 100 servers).
 */
export function createClient(): BotClient {
  return new BotClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
    // The default cache keeps every message forever. This bot never re-reads
    // old messages, so we cap the expensive caches and let the rest go.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 25,
      PresenceManager: 0,
      GuildInviteManager: 0,
      ReactionManager: 0,
    }),
  });
}
