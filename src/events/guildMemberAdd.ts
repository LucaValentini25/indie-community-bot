import { Events, type GuildMember } from 'discord.js';
import { defineEvent } from '../core/types.js';
import { applyJoinRole, sendWelcome } from '../features/welcome/index.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('member-join');

export default defineEvent({
  name: Events.GuildMemberAdd,

  async execute(member: GuildMember) {
    log.debug({ guild: member.guild.id, member: member.id }, 'member joined');

    // Independent side effects: a failing welcome card must not cost the member
    // their role, and vice versa.
    await Promise.allSettled([sendWelcome(member), applyJoinRole(member)]);
  },
});
