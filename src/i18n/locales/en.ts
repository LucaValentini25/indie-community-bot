/**
 * English strings — the reference locale.
 *
 * Every other locale is type-checked against this object, so adding a key here
 * and forgetting to translate it is a compile error, not a runtime `undefined`.
 * Placeholders use {braces} and are filled by `t()`.
 */
export const en = {
  common: {
    enabled: 'Enabled',
    disabled: 'Disabled',
    notSet: '*not set*',
    none: 'None',
    unknown: 'Unknown',
    cancel: 'Cancel',
    confirm: 'Confirm',
    genericError: 'Something went wrong. The team has been notified.',
    guildOnly: 'This command only works inside a server.',
    missingPermission: 'You do not have permission to use this command.',
    missingBotPermission: 'I am missing the **{permissions}** permission in {channel}.',
    channelNotConfigured: 'No channel is configured for this. An admin can set it with `/config set`.',
    channelUnavailable: 'The configured channel no longer exists or I cannot see it.',
  },

  config: {
    title: 'Server configuration',
    description: 'Settings for **{guild}**. Change any of these with `/config set`.',
    updated: 'Updated **{field}** to {value}.',
    reset: 'Cleared **{field}**.',
    sectionGeneral: 'General',
    sectionWelcome: 'Welcome',
    sectionContent: 'Announcements & devlogs',
    sectionBuilds: 'Builds',
    sectionTickets: 'Tickets',
    fieldLocale: 'Language',
    fieldSecondLocale: 'Second language',
    fieldGameName: 'Game name',
    fieldAccentColor: 'Accent color',
    fieldWelcomeEnabled: 'Welcome card',
    fieldWelcomeChannel: 'Welcome channel',
    fieldWelcomeRole: 'Auto-role on join',
    fieldAnnounceChannel: 'Announcements channel',
    fieldDevlogChannel: 'Devlog channel',
    fieldBuildChannel: 'Builds channel',
    fieldBuildRole: 'Build notification role',
    fieldTicketChannel: 'Bug reports channel',
    fieldTicketStaffRole: 'Staff role',
    checkTitle: 'Setup check',
    checkDescription: 'Everything the bot needs in order to work in this server.',
    checkOk: 'Ready',
    checkMissing: 'Not configured',
    checkNoPermission: 'Configured, but I lack permissions',
    fieldServerAvatar: 'Server avatar',
    fieldServerBanner: 'Server banner',
    fieldServerNickname: 'Nickname here',
    sectionIdentity: 'Appearance in this server',
    brandingUpdated: 'Updated **{fields}**.',
    brandingScopeNote:
      'This only changes how I look in this server. My picture everywhere else is unaffected.',
    brandingCleared: 'Cleared. I am back to my default look in this server.',
    brandingNothing: 'Nothing to change — attach an avatar or a banner, or pass a nickname.',
    brandingNotImage: '`{file}` is not an image.',
    brandingTooBig: 'That image is over 10 MB. Discord will not take it.',
    brandingDownloadFailed: 'I could not download that attachment. Try uploading it again.',
    brandingNoPermission: 'I need the **Change Nickname** permission to rename myself here.',
    brandingRejected:
      'Discord rejected that image. Avatars want a square PNG or JPG; animated ones are often refused.',
  },

  access: {
    title: 'Command access',
    description: 'Which roles may use each command in **{guild}**.',
    everyCommand: 'Every command',
    everythingElse: 'Everything else',
    discordDefault: 'whoever Discord’s own permissions allow',
    noRules:
      'No restrictions yet. Every command is gated only by Discord’s own permissions. Use `/access allow` to narrow one down to specific roles.',
    allowed: '{role} can now use **{command}**.',
    alreadyAllowed: '{role} could already use **{command}**.',
    revoked: '{role} can no longer use **{command}**.',
    notAllowed: 'There was no rule giving {role} access to **{command}**.',
    cleared: 'Removed {count} rule(s) from **{command}**.',
    nothingToClear: 'There was nothing to clear for **{command}**.',
    unknownCommand: 'There is no command called **{command}**.',
    selfLocked:
      '`/access` is always Administrator-only — restricting it could lock the server out of its own bot.',
    overridesWildcard:
      '⚠️ A command’s own list replaces the one set for every command, so the roles listed under **Every command** no longer reach **{command}**. Add them here too if they should.',
    denied: 'This command is limited to {roles}.',
    footer:
      'Administrators and the server owner always pass. These rules narrow Discord’s permissions and cannot widen them.',
  },

  selfrole: {
    panelTitle: 'Pick your roles',
    panelDescription: 'Click a button to give yourself a role. Click it again to take it off.',
    added: 'You now have {role}.',
    removed: 'You no longer have {role}.',
    unavailable:
      'That role is not available any more. This panel is out of date — ask an admin to post a new one.',
    listTitle: 'Self-assignable roles',
    listEmpty: 'None yet. Add one with `/selfrole add`, then post the panel with `/selfrole panel`.',
    listCount: '{count} of {max} slots used.',
    addedRule: '{role} is now self-assignable.',
    updatedRule: 'Updated {role}.',
    removedRule: '{role} is no longer self-assignable.',
    notInList: '{role} was not on the panel.',
    roleGone: 'this role no longer exists',
    repostReminder:
      'Run `/selfrole panel` to post an updated panel — messages already posted keep the old buttons.',
    full: 'A panel holds at most {max} roles, which is Discord’s limit of five buttons across five rows.',
    invalidEmoji:
      '`{emoji}` is not something I can put on a button. Use a single emoji, or a custom one as `<:name:id>`.',
    managedRole: '{role} is managed by an integration or a bot, so nobody can be given it by hand.',
    everyoneRole: '@everyone is not a role anyone can opt into.',
    needManageRoles: 'I need the **Manage Roles** permission before I can hand out any role.',
    aboveMe:
      'My own role has to sit above {role} for me to assign it. Move it up in Server Settings → Roles.',
    panelPosted: 'Panel posted in {channel}.',
    panelEmpty: 'Add at least one role with `/selfrole add` before posting the panel.',
  },

  welcome: {
    cardTitle: 'WELCOME',
    cardSubtitle: 'You are member #{count}',
    message: 'Hey {user}, welcome to **{guild}**! Take a look at the rules and say hi.',
    messageWithGame: 'Hey {user}, welcome to the **{game}** community! Take a look at the rules and say hi.',
    testSent: 'Preview sent.',
    backgroundSet: 'Welcome artwork updated for this server.',
    backgroundPreviewHint: 'Run `/welcome test` to see it.',
    backgroundCleared: 'Back to the default artwork.',
    backgroundNothing: 'Pass `url:`, attach a `file:`, or use `clear:true`.',
    backgroundNotUrl: 'That is not a valid http(s) link.',
    backgroundUnreachable:
      'I could not download that image. Check the link is public and direct — a page it sits on will not work, only the image itself.',
    backgroundNotImage: 'That link does not point at an image.',
    backgroundTooBig: 'That image is over 8 MB. Resize it — the card is only 1000x350.',
    backgroundUndecodable: 'I downloaded it but could not read it as an image. PNG, JPG or WebP.',
  },

  announce: {
    noContent: 'Nothing to post — no text was provided for any of this server’s languages.',
    posted: 'Posted in {channel}.',
    announcementFooter: 'Announcement',
    devlogFooter: 'Devlog',
    devlogTitle: 'Devlog #{number} — {title}',
    modalTitleLabel: 'Title',
    modalBodyLabel: 'Body',
    modalImageLabel: 'Image URL (optional)',
    pingEveryone: 'This will ping @everyone.',
  },

  build: {
    newBuild: 'New build available',
    titleWithGame: '{game} — {version}',
    titleWithoutGame: 'Build {version}',
    fieldVersion: 'Version',
    fieldChannel: 'Channel',
    fieldPlatforms: 'Platforms',
    fieldChangelog: 'Changelog',
    download: 'Download',
    viewChangelog: 'Full changelog',
    footerSource: 'Published from {source}',
    posted: 'Build **{version}** announced in {channel}.',
    duplicate: 'Build **{version}** on channel **{channel}** was already announced.',
    latestTitle: 'Latest build',
    noBuilds: 'No builds have been announced yet.',
    listTitle: 'Recent builds',
  },

  ticket: {
    panelTitle: 'Found a bug?',
    panelDescription:
      'Press the button below to open a private report. Describe what happened, how to reproduce it, and which build you were on — that is what makes a bug fixable.',
    panelButton: 'Report a bug',
    panelPosted: 'Bug report panel posted in {channel}.',

    modalTitle: 'Report a bug',
    modalSummaryLabel: 'Short summary',
    modalSummaryPlaceholder: 'The game crashes when I open the map',
    modalDetailsLabel: 'What happened? How do we reproduce it?',
    modalDetailsPlaceholder: '1. Start a new game\n2. Press M\n3. The game freezes',
    modalPlatformLabel: 'Platform (Windows / Mac / Linux / Steam Deck)',
    modalVersionLabel: 'Build version (optional)',

    created: 'Thanks! Your report is {thread} — follow up there.',
    threadName: 'bug-{number}-{summary}',
    embedTitle: 'Bug #{number}: {summary}',
    fieldReporter: 'Reported by',
    fieldPlatform: 'Platform',
    fieldVersion: 'Build',
    fieldStatus: 'Status',
    openingMessage:
      '{user} thank you for the report. {staff} will take a look. Screenshots, a video or a log file help a lot — you can drop them in this thread.',

    closePrompt: 'How was this resolved?',
    buttonClose: 'Close',
    buttonReopen: 'Reopen',
    buttonClaim: 'Claim',

    statusOpen: 'Open',
    statusClaimed: 'In progress',
    statusClosed: 'Closed',

    resolutionFixed: 'Fixed',
    resolutionDuplicate: 'Duplicate',
    resolutionNotABug: 'Not a bug',
    resolutionWontFix: "Won't fix",
    resolutionNoRepro: 'Cannot reproduce',

    claimed: 'Claimed by {user}.',
    closed: 'Closed by {user} — **{resolution}**.',
    reopened: 'Reopened by {user}.',
    notATicket: 'This command only works inside a bug report thread.',
    alreadyClosed: 'This report is already closed.',
    notClosed: 'This report is not closed.',
    listTitle: 'Open bug reports',
    listEmpty: 'No open reports. ',
    listEntry: '**#{number}** — {summary} · <#{thread}>',
  },

  http: {
    // Not user-facing in Discord, but kept here so error text stays in one place.
    unauthorized: 'Invalid or missing webhook secret.',
    badRequest: 'Malformed payload.',
    guildNotFound: 'Unknown guild, or the bot is not a member of it.',
  },
} as const;
