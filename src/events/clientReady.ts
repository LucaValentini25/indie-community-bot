import { ActivityType, Events, type Client } from 'discord.js';
import { defineEvent } from '../core/types.js';
import { getGuildConfig } from '../config/guild.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('ready');

export default defineEvent({
  name: Events.ClientReady,

  async execute(client: Client<true>) {
    log.info({ user: client.user.tag, guilds: client.guilds.cache.size }, 'connected to Discord');

    // Make sure every guild we are already in has a config row, so a restart
    // after being invited while offline still works.
    for (const guild of client.guilds.cache.values()) {
      getGuildConfig(guild.id);
    }

    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'the community', type: ActivityType.Watching }],
    });
  },
});
