import type { APIGuildMember } from 'discord-api-types/v10';
import { updateGuildConfig, type GuildConfig } from '../config/guild.js';
import {
  brandedEmbed,
  contextForUser,
  getBotMember,
  getGuildInfo,
  getGuildRoles,
  resolveSendableChannel,
} from '../lib/context.js';
import { isLocale, type Translate } from '../../../src/i18n/index.js';
import { parseHexColor } from '../../../src/lib/text.js';
import { DiscordApiError } from '../discord/rest.js';
import { channelPermissions, has, highestRolePosition, Perm } from '../discord/permissions.js';
import { EPHEMERAL } from '../discord/message.js';
import type { Interaction } from '../discord/interaction.js';
import type { App } from '../types.js';
import type { WorkerCommand } from './types.js';

/**
 * The bot has two separate appearances, and mixing them up is the usual
 * mistake here: a **global** identity (one picture for the whole application,
 * heavily rate limited) and a **per-guild server profile**, which is what
 * `/config branding` sets. Discord stores the latter, so nothing is persisted
 * here and `/config view` reads it back off the bot's own membership.
 */
const PROFILE_RESETS: Record<string, 'avatar' | 'banner' | 'nick' | undefined> = {
  serverAvatar: 'avatar',
  serverBanner: 'banner',
  serverNickname: 'nick',
};

/** Discord rejects anything larger; checked here to give a better message. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const config: WorkerCommand = {
  async execute(app, ix) {
    const guildId = ix.guildId!;
    // /config only ever replies ephemerally, so it speaks the admin's language.
    const { config: current, s } = await contextForUser(app, guildId, ix.locale);
    const subcommand = ix.options.subcommand;

    // Nearly every path reads the server or the bot's membership from the API,
    // so acknowledge first and answer with `editReply`.
    await ix.deferReply({ flags: EPHEMERAL });

    if (subcommand === 'view') {
      await ix.editReply({ embeds: [await configEmbed(app, guildId, current, s)] });
      return;
    }

    if (subcommand === 'check') {
      await ix.editReply({ embeds: [await checkEmbed(app, guildId, current, s)] });
      return;
    }

    if (subcommand === 'reset') {
      const setting = ix.options.getString('setting', true);

      // The server profile is stored by Discord, not by us, so these three
      // clear through the API rather than through a database column.
      const profileField = PROFILE_RESETS[setting];
      if (profileField) {
        try {
          await app.rest.editMyMember(guildId, { [profileField]: null });
          await ix.editReply({ content: s('config.brandingCleared') });
        } catch (error) {
          await ix.editReply({ content: describeProfileFailure(error, s) });
        }
        return;
      }

      await updateGuildConfig(app, guildId, { [setting]: null });
      await ix.editReply({ content: s('config.reset', { field: setting }) });
      return;
    }

    if (subcommand === 'branding') {
      await applyBranding(app, ix, s);
      return;
    }

    // The three "set" subcommands share one shape: read every supplied option,
    // build a patch, apply it, and echo back only what changed.
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    if (subcommand === 'channels') {
      collect(patch, changed, 'welcomeChannelId', ix.options.getChannelId('welcome'), 'Welcome');
      collect(patch, changed, 'announceChannelId', ix.options.getChannelId('announcements'), 'Announcements');
      collect(patch, changed, 'devlogChannelId', ix.options.getChannelId('devlogs'), 'Devlogs');
      collect(patch, changed, 'buildChannelId', ix.options.getChannelId('builds'), 'Builds');
      collect(patch, changed, 'ticketChannelId', ix.options.getChannelId('bugs'), 'Bug reports');

      for (const [option, field, label] of [
        ['welcome_secondary', 'welcomeChannelSecondaryId', 'Welcome (2nd language)'],
        ['announcements_secondary', 'announceChannelSecondaryId', 'Announcements (2nd language)'],
        ['devlogs_secondary', 'devlogChannelSecondaryId', 'Devlogs (2nd language)'],
        ['builds_secondary', 'buildChannelSecondaryId', 'Builds (2nd language)'],
      ] as const) {
        collect(patch, changed, field, ix.options.getChannelId(option), label);
      }

      // Setting a welcome channel with the feature still off is almost always
      // a mistake, so turn it on for them.
      if (patch.welcomeChannelId && !current.welcomeEnabled) {
        patch.welcomeEnabled = true;
        changed.push('Welcome card → on');
      }
    }

    if (subcommand === 'roles') {
      collect(patch, changed, 'welcomeRoleId', ix.options.getRole('join')?.id, 'Join role');
      collect(patch, changed, 'buildRoleId', ix.options.getRole('builds')?.id, 'Build role');
      collect(patch, changed, 'ticketStaffRoleId', ix.options.getRole('staff')?.id, 'Staff role');
    }

    if (subcommand === 'general') {
      const language = ix.options.getString('language');
      if (language && isLocale(language)) collect(patch, changed, 'locale', language, 'Language');

      const second = ix.options.getString('second_language');
      if (second && isLocale(second)) collect(patch, changed, 'secondaryLocale', second, 'Second language');

      collect(patch, changed, 'gameName', ix.options.getString('game_name') ?? undefined, 'Game name');

      const color = ix.options.getString('accent_color');
      if (color) {
        if (parseHexColor(color) === null) {
          await ix.editReply({ content: 'Accent color must be a hex value like `#FF5C00`.' });
          return;
        }
        collect(patch, changed, 'accentColor', color.startsWith('#') ? color : `#${color}`, 'Accent color');
      }

      const welcomeEnabled = ix.options.getBoolean('welcome_enabled');
      if (welcomeEnabled !== null) collect(patch, changed, 'welcomeEnabled', welcomeEnabled, 'Welcome card');
    }

    if (changed.length === 0) {
      await ix.editReply({ content: 'Nothing to change — pass at least one option.' });
      return;
    }

    const updated = await updateGuildConfig(app, guildId, patch);

    await ix.editReply({
      content: `✅ ${changed.join(', ')}`,
      embeds: [await configEmbed(app, guildId, updated, s)],
    });
  },
};

function collect(
  patch: Record<string, unknown>,
  changed: string[],
  field: string,
  value: unknown,
  label: string,
): void {
  if (value === undefined || value === null) return;
  patch[field] = value;
  changed.push(label);
}

// ─────────────────────────────────────────────────────────────
//  Branding
// ─────────────────────────────────────────────────────────────

async function applyBranding(app: App, ix: Interaction, s: Translate): Promise<void> {
  const patch: { nick?: string | null; avatar?: string | null; banner?: string | null } = {};
  const changed: string[] = [];

  for (const [option, field] of [
    ['avatar', 'avatar'],
    ['banner', 'banner'],
  ] as const) {
    const attachment = ix.options.getAttachment(option);
    if (!attachment) continue;

    if (!attachment.content_type?.startsWith('image/')) {
      await ix.editReply({ content: s('config.brandingNotImage', { file: attachment.filename }) });
      return;
    }
    if (attachment.size > MAX_IMAGE_BYTES) {
      await ix.editReply({ content: s('config.brandingTooBig') });
      return;
    }

    const image = await downloadAsDataUri(attachment.url, attachment.content_type);
    if (!image) {
      await ix.editReply({ content: s('config.brandingDownloadFailed') });
      return;
    }

    patch[field] = image;
    changed.push(field === 'avatar' ? s('config.fieldServerAvatar') : s('config.fieldServerBanner'));
  }

  const nickname = ix.options.getString('nickname');
  if (nickname !== null) {
    patch.nick = nickname;
    changed.push(s('config.fieldServerNickname'));
  }

  if (changed.length === 0) {
    await ix.editReply({ content: s('config.brandingNothing') });
    return;
  }

  try {
    await app.rest.editMyMember(ix.guildId!, patch);
  } catch (error) {
    await ix.editReply({ content: describeProfileFailure(error, s) });
    return;
  }

  await ix.editReply({
    content: `✅ ${s('config.brandingUpdated', { fields: changed.join(', ') })}\n${s('config.brandingScopeNote')}`,
  });
}

/** Fetches an image and encodes it the way Discord's profile endpoint expects. Null on failure. */
async function downloadAsDataUri(url: string, contentType: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    // Chunked: spreading a multi-megabyte array into one call overflows the stack.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** Discord's failures here are specific and actionable, so they are worth separating. */
function describeProfileFailure(error: unknown, s: Translate): string {
  const code = error instanceof DiscordApiError ? error.code : undefined;
  if (code === 50013) return s('config.brandingNoPermission');
  if (code === 50035) return s('config.brandingRejected');
  return s('common.genericError');
}

// ─────────────────────────────────────────────────────────────
//  Views
// ─────────────────────────────────────────────────────────────

async function configEmbed(app: App, guildId: string, config: GuildConfig, s: Translate) {
  const [guild, me] = await Promise.all([
    getGuildInfo(app, guildId),
    // The bot's own profile is read back from Discord rather than a column:
    // Discord owns that state, so it is the only source that cannot go stale.
    getBotMember(app, guildId).catch((): APIGuildMember | null => null),
  ]);

  const channel = (id: string | null) => (id ? `<#${id}>` : s('common.notSet'));
  const role = (id: string | null) => (id ? `<@&${id}>` : s('common.notSet'));
  // Only when set: unset means the second language shares the channel above.
  const secondary = (label: string, id: string | null) =>
    id ? [`**${label} ${s('config.fieldSecondaryChannel')}:** ${channel(id)}`] : [];
  const yes = (set: boolean) => (set ? s('common.enabled') : s('common.notSet'));

  return brandedEmbed(config)
    .setTitle(s('config.title'))
    .setDescription(s('config.description', { guild: guild.name }))
    .addFields(
      {
        name: s('config.sectionGeneral'),
        value: [
          `**${s('config.fieldLocale')}:** \`${config.locale}\``,
          `**${s('config.fieldSecondLocale')}:** ${config.secondaryLocale ? `\`${config.secondaryLocale}\`` : s('common.none')}`,
          `**${s('config.fieldGameName')}:** ${config.gameName ?? s('common.notSet')}`,
          `**${s('config.fieldAccentColor')}:** \`${config.accentColor}\``,
        ].join('\n'),
      },
      {
        name: s('config.sectionWelcome'),
        value: [
          `**${s('config.fieldWelcomeEnabled')}:** ${config.welcomeEnabled ? s('common.enabled') : s('common.disabled')}`,
          `**${s('config.fieldWelcomeChannel')}:** ${channel(config.welcomeChannelId)}`,
          ...secondary(s('config.fieldWelcomeChannel'), config.welcomeChannelSecondaryId),
          `**${s('config.fieldWelcomeRole')}:** ${role(config.welcomeRoleId)}`,
        ].join('\n'),
      },
      {
        name: s('config.sectionContent'),
        value: [
          `**${s('config.fieldAnnounceChannel')}:** ${channel(config.announceChannelId)}`,
          ...secondary(s('config.fieldAnnounceChannel'), config.announceChannelSecondaryId),
          `**${s('config.fieldDevlogChannel')}:** ${channel(config.devlogChannelId)}`,
          ...secondary(s('config.fieldDevlogChannel'), config.devlogChannelSecondaryId),
        ].join('\n'),
      },
      {
        name: s('config.sectionBuilds'),
        value: [
          `**${s('config.fieldBuildChannel')}:** ${channel(config.buildChannelId)}`,
          ...secondary(s('config.fieldBuildChannel'), config.buildChannelSecondaryId),
          `**${s('config.fieldBuildRole')}:** ${role(config.buildRoleId)}`,
        ].join('\n'),
      },
      {
        name: s('config.sectionIdentity'),
        value: [
          `**${s('config.fieldServerNickname')}:** ${me?.nick ?? s('common.notSet')}`,
          `**${s('config.fieldServerAvatar')}:** ${yes(Boolean(me?.avatar))}`,
          `**${s('config.fieldServerBanner')}:** ${yes(Boolean((me as { banner?: string | null } | null)?.banner))}`,
        ].join('\n'),
      },
      {
        name: s('config.sectionTickets'),
        value: [
          `**${s('config.fieldTicketChannel')}:** ${channel(config.ticketChannelId)}`,
          `**${s('config.fieldTicketStaffRole')}:** ${role(config.ticketStaffRoleId)}`,
        ].join('\n'),
      },
    );
}

/**
 * Walks every configured channel and reports whether the bot can actually use
 * it. This is the command to run when "the bot isn't posting" — it turns a
 * silent permission problem into a visible line item.
 */
async function checkEmbed(app: App, guildId: string, config: GuildConfig, s: Translate) {
  const targets: { label: string; id: string | null; extra?: bigint[] }[] = [
    {
      label: s('config.fieldWelcomeChannel'),
      id: config.welcomeEnabled ? config.welcomeChannelId : null,
      extra: [Perm.AttachFiles],
    },
    { label: s('config.fieldAnnounceChannel'), id: config.announceChannelId },
    { label: s('config.fieldDevlogChannel'), id: config.devlogChannelId },
    { label: s('config.fieldBuildChannel'), id: config.buildChannelId },
    {
      label: s('config.fieldTicketChannel'),
      id: config.ticketChannelId,
      extra: [Perm.CreatePrivateThreads, Perm.SendMessagesInThreads],
    },
  ];

  // Second-language channels are checked only when set. Unset is not "missing":
  // it means that language shares the primary channel. A set but unusable one
  // matters more than it looks, because publishing is all or nothing.
  const secondaries = [
    {
      label: s('config.fieldWelcomeChannel'),
      id: config.welcomeEnabled ? config.welcomeChannelSecondaryId : null,
      extra: [Perm.AttachFiles],
    },
    { label: s('config.fieldAnnounceChannel'), id: config.announceChannelSecondaryId },
    { label: s('config.fieldDevlogChannel'), id: config.devlogChannelSecondaryId },
    { label: s('config.fieldBuildChannel'), id: config.buildChannelSecondaryId },
  ];
  for (const target of secondaries) {
    if (target.id) targets.push({ ...target, label: `${target.label} ${s('config.fieldSecondaryChannel')}` });
  }

  const lines: string[] = [];

  for (const target of targets) {
    if (!target.id) {
      lines.push(`⚪ **${target.label}** — ${s('config.checkMissing')}`);
      continue;
    }

    const lookup = await resolveSendableChannel(app, guildId, target.id, [
      Perm.ViewChannel,
      Perm.SendMessages,
      ...(target.extra ?? []),
    ]);

    if (lookup.ok) {
      lines.push(`🟢 **${target.label}** — ${s('config.checkOk')} (<#${target.id}>)`);
    } else if (lookup.reason === 'missing-permission') {
      lines.push(`🔴 **${target.label}** — ${s('config.checkNoPermission')}: \`${lookup.missing}\``);
    } else {
      lines.push(`🔴 **${target.label}** — ${s('common.channelUnavailable')}`);
    }
  }

  // Role hierarchy is the other classic silent failure.
  if (config.welcomeRoleId) {
    const [roles, me] = await Promise.all([getGuildRoles(app, guildId), getBotMember(app, guildId)]);
    const target = roles.find((candidate) => candidate.id === config.welcomeRoleId);
    const permissions = channelPermissions({
      guildId,
      memberId: app.botId,
      memberRoleIds: me.roles,
      roles,
      overwrites: [],
    });
    const canAssign =
      has(permissions, Perm.ManageRoles) && target && highestRolePosition(roles, me.roles) > target.position;

    lines.push(
      canAssign
        ? `🟢 **${s('config.fieldWelcomeRole')}** — ${s('config.checkOk')}`
        : `🔴 **${s('config.fieldWelcomeRole')}** — need Manage Roles and a higher role than <@&${config.welcomeRoleId}>`,
    );
  }

  return brandedEmbed(config)
    .setTitle(s('config.checkTitle'))
    .setDescription(`${s('config.checkDescription')}\n\n${lines.join('\n')}`);
}
