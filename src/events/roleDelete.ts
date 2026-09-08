import { Events, type Role } from 'discord.js';
import { defineEvent } from '../core/types.js';
import { forgetRole } from '../config/access.js';
import { removeSelfRole } from '../features/selfroles/repository.js';
import { getGuildConfig, updateGuildConfig, type EditableField, type GuildConfig } from '../config/guild.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('roles');

/**
 * A deleted role must not keep appearing in the bot's settings.
 *
 * For `/access` this matters more than tidiness: a rule naming a role nobody
 * can hold locks the command for everyone below Administrator, and the symptom
 * — "the bot stopped answering" — points nowhere near the deleted role.
 */
export default defineEvent({
  name: Events.GuildRoleDelete,

  execute(role: Role) {
    const rules = forgetRole(role.guild.id, role.id);
    // Also drop it from the self-service panel, whose button would otherwise
    // stay on an already-posted message and fail for whoever clicked it.
    const panelled = removeSelfRole(role.guild.id, role.id);

    // The configured roles are single columns, so clear whichever pointed here.
    const config = getGuildConfig(role.guild.id);
    const patch: Partial<Pick<GuildConfig, EditableField>> = {};
    if (config.welcomeRoleId === role.id) patch.welcomeRoleId = null;
    if (config.buildRoleId === role.id) patch.buildRoleId = null;
    if (config.ticketStaffRoleId === role.id) patch.ticketStaffRoleId = null;

    const settings = Object.keys(patch);
    if (settings.length > 0) updateGuildConfig(role.guild.id, patch);

    if (rules > 0 || panelled || settings.length > 0) {
      log.info(
        { guild: role.guild.id, role: role.id, rules, panelled, settings },
        'cleaned up a deleted role',
      );
    }
  },
});
