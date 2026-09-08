import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMemberEditMeOptions,
} from 'discord.js';
import { forgetGuildConfig, updateGuildConfig, type GuildConfig } from '../../config/guild.js';
import { brandedEmbed, contextForUser, resolveSendableChannel } from '../../lib/context.js';
import { isLocale, type Translate } from '../../i18n/index.js';
import { parseHexColor } from '../../lib/text.js';
import type { Command } from '../../core/types.js';

/**
 * All runtime configuration lives behind this one command, grouped by what an
 * admin is actually doing ("set my channels", "set my roles") rather than by
 * database column.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure the bot for this server')
    .setDescriptionLocalizations({ 'es-ES': 'Configurar el bot para este servidor' })
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('Show the current configuration')
        .setDescriptionLocalizations({ 'es-ES': 'Ver la configuración actual' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('Verify channels, roles and permissions are usable')
        .setDescriptionLocalizations({ 'es-ES': 'Verificar canales, roles y permisos' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('channels')
        .setDescription('Set the channels the bot posts to')
        .setDescriptionLocalizations({ 'es-ES': 'Definir los canales donde publica el bot' })
        .addChannelOption((option) =>
          option
            .setName('welcome')
            .setDescription('Where welcome cards are posted')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('announcements')
            .setDescription('Where /announce posts')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((option) =>
          option
            .setName('devlogs')
            .setDescription('Where /devlog posts (defaults to announcements)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((option) =>
          option
            .setName('builds')
            .setDescription('Where build announcements are posted')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((option) =>
          option
            .setName('bugs')
            .setDescription('Where the bug panel lives and report threads are created')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('roles')
        .setDescription('Set the roles the bot uses')
        .setDescriptionLocalizations({ 'es-ES': 'Definir los roles que usa el bot' })
        .addRoleOption((option) =>
          option.setName('join').setDescription('Role given automatically to new members'),
        )
        .addRoleOption((option) =>
          option.setName('builds').setDescription('Role pinged when a new build ships'),
        )
        .addRoleOption((option) =>
          option.setName('staff').setDescription('Role allowed to claim and close bug reports'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('general')
        .setDescription('Language, branding and toggles')
        .setDescriptionLocalizations({ 'es-ES': 'Idioma, branding e interruptores' })
        .addStringOption((option) =>
          option
            .setName('language')
            .setDescription('Language the bot replies in')
            .addChoices({ name: 'English', value: 'en' }, { name: 'Español', value: 'es' }),
        )
        .addStringOption((option) =>
          option
            .setName('second_language')
            .setDescription('Also publish everything public in this language')
            .setDescriptionLocalizations({
              'es-ES': 'Publicar además todo lo público en este idioma',
            })
            .addChoices({ name: 'English', value: 'en' }, { name: 'Español', value: 'es' }),
        )
        .addStringOption((option) =>
          option.setName('game_name').setDescription('Shown on cards and embeds').setMaxLength(60),
        )
        .addStringOption((option) =>
          option.setName('accent_color').setDescription('Hex color, e.g. #FF5C00').setMaxLength(7),
        )
        .addBooleanOption((option) =>
          option.setName('welcome_enabled').setDescription('Turn welcome cards on or off'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('branding')
        .setDescription("The bot's own name and picture in this server")
        .setDescriptionLocalizations({ 'es-ES': 'El nombre y la imagen del bot en este servidor' })
        .addAttachmentOption((option) =>
          option
            .setName('avatar')
            .setDescription('Profile picture, only in this server. Square, PNG or JPG.')
            .setDescriptionLocalizations({
              'es-ES': 'Foto de perfil, solo en este servidor. Cuadrada, PNG o JPG.',
            }),
        )
        .addAttachmentOption((option) =>
          option
            .setName('banner')
            .setDescription('Profile banner, only in this server')
            .setDescriptionLocalizations({ 'es-ES': 'Portada del perfil, solo en este servidor' }),
        )
        .addStringOption((option) =>
          option
            .setName('nickname')
            .setDescription('Name the bot goes by in this server')
            .setDescriptionLocalizations({ 'es-ES': 'Nombre que usa el bot en este servidor' })
            .setMaxLength(32),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Clear a setting')
        .setDescriptionLocalizations({ 'es-ES': 'Borrar una configuración' })
        .addStringOption((option) =>
          option
            .setName('setting')
            .setDescription('Which setting to clear')
            .setRequired(true)
            .addChoices(
              { name: 'Welcome channel', value: 'welcomeChannelId' },
              { name: 'Join role', value: 'welcomeRoleId' },
              { name: 'Announcements channel', value: 'announceChannelId' },
              { name: 'Devlog channel', value: 'devlogChannelId' },
              { name: 'Builds channel', value: 'buildChannelId' },
              { name: 'Build role', value: 'buildRoleId' },
              { name: 'Bug channel', value: 'ticketChannelId' },
              { name: 'Staff role', value: 'ticketStaffRoleId' },
              { name: 'Game name', value: 'gameName' },
              { name: 'Second language', value: 'secondaryLocale' },
              { name: 'Server avatar', value: 'serverAvatar' },
              { name: 'Server banner', value: 'serverBanner' },
              { name: 'Server nickname', value: 'serverNickname' },
            ),
        ),
    ),

  async execute(interaction) {
    const guild = interaction.guild!;
    // /config only ever replies ephemerally, so it speaks the admin's language.
    const { config, s } = contextForUser(guild.id, interaction.locale);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      await interaction.reply({
        embeds: [configEmbed(config, guild, s)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'check') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ embeds: [await checkEmbed(guild, config, s)] });
      return;
    }

    if (subcommand === 'reset') {
      const setting = interaction.options.getString('setting', true);

      // The server profile is stored by Discord, not by us, so these three
      // clear through the API rather than through a database column.
      const profileField = PROFILE_RESETS[setting];
      if (profileField) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await guild.members.editMe({ [profileField]: null });
          await interaction.editReply({ content: s('config.brandingCleared') });
        } catch (error) {
          await interaction.editReply({ content: describeProfileFailure(error, s) });
        }
        return;
      }

      updateGuildConfig(guild.id, { [setting]: null });
      await interaction.reply({
        content: s('config.reset', { field: setting }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'branding') {
      // Downloading two images can outrun the 3s window, so defer first.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await applyBranding(interaction, s);
      return;
    }

    // The three "set" subcommands share one shape: read every supplied option,
    // build a patch, apply it, and echo back only what changed.
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    if (subcommand === 'channels') {
      collect(patch, changed, 'welcomeChannelId', interaction.options.getChannel('welcome')?.id, 'Welcome');
      collect(
        patch,
        changed,
        'announceChannelId',
        interaction.options.getChannel('announcements')?.id,
        'Announcements',
      );
      collect(patch, changed, 'devlogChannelId', interaction.options.getChannel('devlogs')?.id, 'Devlogs');
      collect(patch, changed, 'buildChannelId', interaction.options.getChannel('builds')?.id, 'Builds');
      collect(patch, changed, 'ticketChannelId', interaction.options.getChannel('bugs')?.id, 'Bug reports');

      // Setting a welcome channel with the feature still off is almost always
      // a mistake, so turn it on for them.
      if (patch.welcomeChannelId && !config.welcomeEnabled) {
        patch.welcomeEnabled = true;
        changed.push('Welcome card → on');
      }
    }

    if (subcommand === 'roles') {
      collect(patch, changed, 'welcomeRoleId', interaction.options.getRole('join')?.id, 'Join role');
      collect(patch, changed, 'buildRoleId', interaction.options.getRole('builds')?.id, 'Build role');
      collect(patch, changed, 'ticketStaffRoleId', interaction.options.getRole('staff')?.id, 'Staff role');
    }

    if (subcommand === 'general') {
      const language = interaction.options.getString('language');
      if (language && isLocale(language)) collect(patch, changed, 'locale', language, 'Language');

      const second = interaction.options.getString('second_language');
      if (second && isLocale(second)) {
        collect(patch, changed, 'secondaryLocale', second, 'Second language');
      }

      collect(
        patch,
        changed,
        'gameName',
        interaction.options.getString('game_name') ?? undefined,
        'Game name',
      );

      const color = interaction.options.getString('accent_color');
      if (color) {
        if (parseHexColor(color) === null) {
          await interaction.reply({
            content: 'Accent color must be a hex value like `#FF5C00`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        collect(patch, changed, 'accentColor', color.startsWith('#') ? color : `#${color}`, 'Accent color');
      }

      const welcomeEnabled = interaction.options.getBoolean('welcome_enabled');
      if (welcomeEnabled !== null) {
        collect(patch, changed, 'welcomeEnabled', welcomeEnabled, 'Welcome card');
      }
    }

    if (changed.length === 0) {
      await interaction.reply({
        content: 'Nothing to change — pass at least one option.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = updateGuildConfig(guild.id, patch);
    forgetGuildConfig(guild.id);

    await interaction.reply({
      content: `✅ ${changed.join(', ')}`,
      embeds: [configEmbed(updated, guild, s)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/**
 * The bot has two separate appearances, and mixing them up is the usual
 * mistake here:
 *
 *  - A **global** identity (`client.user.setAvatar()`) — one picture for the
 *    whole application, seen in DMs and on the bot's profile card. It is
 *    shared by every server and rate limited to a couple of changes per hour,
 *    so it must never be driven per guild: two communities would fight over it
 *    and both would end up throttled.
 *  - A **per-guild server profile** (`guild.members.editMe()`), which is what
 *    this subcommand sets. Avatar, banner and nickname, independent in every
 *    server.
 *
 * Discord stores the result, so there is nothing to persist here and nothing
 * to re-apply on boot — unlike the rest of `/config`, this writes no database
 * row. `/config view` reads the current values back off our own member.
 */
const PROFILE_RESETS: Record<string, 'avatar' | 'banner' | 'nick' | undefined> = {
  serverAvatar: 'avatar',
  serverBanner: 'banner',
  serverNickname: 'nick',
};

/** Discord rejects anything larger; checked here to give a better message. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function applyBranding(interaction: ChatInputCommandInteraction, s: Translate): Promise<void> {
  const guild = interaction.guild!;
  const patch: GuildMemberEditMeOptions = {};
  const changed: string[] = [];

  for (const [option, field] of [
    ['avatar', 'avatar'],
    ['banner', 'banner'],
  ] as const) {
    const attachment = interaction.options.getAttachment(option);
    if (!attachment) continue;

    if (!attachment.contentType?.startsWith('image/')) {
      await interaction.editReply({ content: s('config.brandingNotImage', { file: attachment.name }) });
      return;
    }
    if (attachment.size > MAX_IMAGE_BYTES) {
      await interaction.editReply({ content: s('config.brandingTooBig') });
      return;
    }

    const image = await downloadImage(attachment.url);
    if (!image) {
      await interaction.editReply({ content: s('config.brandingDownloadFailed') });
      return;
    }

    patch[field] = image;
    changed.push(field === 'avatar' ? s('config.fieldServerAvatar') : s('config.fieldServerBanner'));
  }

  const nickname = interaction.options.getString('nickname');
  if (nickname !== null) {
    patch.nick = nickname;
    changed.push(s('config.fieldServerNickname'));
  }

  if (changed.length === 0) {
    await interaction.editReply({ content: s('config.brandingNothing') });
    return;
  }

  try {
    await guild.members.editMe(patch);
  } catch (error) {
    await interaction.editReply({ content: describeProfileFailure(error, s) });
    return;
  }

  await interaction.editReply({
    content: `✅ ${s('config.brandingUpdated', { fields: changed.join(', ') })}\n${s('config.brandingScopeNote')}`,
  });
}

/** Fetches the attachment as bytes. Null on any failure — the caller explains. */
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Discord's failures here are specific and actionable, so they are worth
 * separating rather than collapsing into "something went wrong".
 */
function describeProfileFailure(error: unknown, s: Translate): string {
  const code = (error as { code?: number }).code;
  if (code === 50013) return s('config.brandingNoPermission');
  if (code === 50035) return s('config.brandingRejected');
  return s('common.genericError');
}

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

function configEmbed(config: GuildConfig, guild: Guild, s: Translate) {
  const channel = (id: string | null) => (id ? `<#${id}>` : s('common.notSet'));
  const role = (id: string | null) => (id ? `<@&${id}>` : s('common.notSet'));

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
          `**${s('config.fieldWelcomeRole')}:** ${role(config.welcomeRoleId)}`,
        ].join('\n'),
      },
      {
        name: s('config.sectionContent'),
        value: [
          `**${s('config.fieldAnnounceChannel')}:** ${channel(config.announceChannelId)}`,
          `**${s('config.fieldDevlogChannel')}:** ${channel(config.devlogChannelId)}`,
        ].join('\n'),
      },
      {
        name: s('config.sectionBuilds'),
        value: [
          `**${s('config.fieldBuildChannel')}:** ${channel(config.buildChannelId)}`,
          `**${s('config.fieldBuildRole')}:** ${role(config.buildRoleId)}`,
        ].join('\n'),
      },
      {
        name: s('config.sectionIdentity'),
        value: (() => {
          // Read back off our own member rather than a column: Discord owns
          // this state, so it is the only source that cannot go stale.
          const me = guild.members.me;
          const yes = (set: boolean) => (set ? s('common.enabled') : s('common.notSet'));
          return [
            `**${s('config.fieldServerNickname')}:** ${me?.nickname ?? s('common.notSet')}`,
            `**${s('config.fieldServerAvatar')}:** ${yes(Boolean(me?.avatar))}`,
            `**${s('config.fieldServerBanner')}:** ${yes(Boolean(me?.banner))}`,
          ].join('\n');
        })(),
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
async function checkEmbed(guild: Guild, config: GuildConfig, s: Translate) {
  const targets: { label: string; id: string | null; extra?: bigint[] }[] = [
    {
      label: s('config.fieldWelcomeChannel'),
      id: config.welcomeEnabled ? config.welcomeChannelId : null,
      extra: [PermissionFlagsBits.AttachFiles],
    },
    { label: s('config.fieldAnnounceChannel'), id: config.announceChannelId },
    { label: s('config.fieldDevlogChannel'), id: config.devlogChannelId },
    { label: s('config.fieldBuildChannel'), id: config.buildChannelId },
    {
      label: s('config.fieldTicketChannel'),
      id: config.ticketChannelId,
      extra: [PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads],
    },
  ];

  const lines: string[] = [];

  for (const target of targets) {
    if (!target.id) {
      lines.push(`⚪ **${target.label}** — ${s('config.checkMissing')}`);
      continue;
    }

    const lookup = await resolveSendableChannel(guild, target.id, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
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
    const me = guild.members.me;
    const role = guild.roles.cache.get(config.welcomeRoleId);
    const canAssign =
      me?.permissions.has(PermissionFlagsBits.ManageRoles) &&
      role &&
      me.roles.highest.comparePositionTo(role) > 0;
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

export default command;
