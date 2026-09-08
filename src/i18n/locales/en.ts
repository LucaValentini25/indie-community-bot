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
  },

  welcome: {
    cardTitle: 'WELCOME',
    cardSubtitle: 'You are member #{count}',
    message: 'Hey {user}, welcome to **{guild}**! Take a look at the rules and say hi.',
    messageWithGame: 'Hey {user}, welcome to the **{game}** community! Take a look at the rules and say hi.',
    testSent: 'Preview sent.',
  },

  announce: {
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
