import { Events, type Guild } from 'discord.js';
import { defineEvent } from '../core/types.js';
import { getGuildConfig } from '../config/guild.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('guild');

export default defineEvent({
  name: Events.GuildCreate,

  async execute(guild: Guild) {
    // Creates the default config row so /config view works immediately.
    getGuildConfig(guild.id);
    log.info({ guild: guild.id, name: guild.name, members: guild.memberCount }, 'joined a new guild');
  },
});
