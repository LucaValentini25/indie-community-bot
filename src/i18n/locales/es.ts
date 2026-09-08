import type { LocaleStrings } from '../index.js';

/**
 * Spanish strings. Neutral Latin American Spanish, informal "vos/tú"-agnostic
 * phrasing where possible so it reads naturally across the region.
 */
export const es: LocaleStrings = {
  common: {
    enabled: 'Activado',
    disabled: 'Desactivado',
    notSet: '*sin configurar*',
    none: 'Ninguno',
    unknown: 'Desconocido',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    genericError: 'Algo salió mal. Ya avisamos al equipo.',
    guildOnly: 'Este comando solo funciona dentro de un servidor.',
    missingPermission: 'No tenés permiso para usar este comando.',
    missingBotPermission: 'Me falta el permiso **{permissions}** en {channel}.',
    channelNotConfigured:
      'No hay un canal configurado para esto. Un admin puede definirlo con `/config set`.',
    channelUnavailable: 'El canal configurado ya no existe o no puedo verlo.',
  },

  config: {
    title: 'Configuración del servidor',
    description: 'Ajustes de **{guild}**. Podés cambiarlos con `/config set`.',
    updated: 'Se actualizó **{field}** a {value}.',
    reset: 'Se borró **{field}**.',
    sectionGeneral: 'General',
    sectionWelcome: 'Bienvenida',
    sectionContent: 'Anuncios y devlogs',
    sectionBuilds: 'Builds',
    sectionTickets: 'Tickets',
    fieldLocale: 'Idioma',
    fieldGameName: 'Nombre del juego',
    fieldAccentColor: 'Color de acento',
    fieldWelcomeEnabled: 'Tarjeta de bienvenida',
    fieldWelcomeChannel: 'Canal de bienvenida',
    fieldWelcomeRole: 'Rol automático al entrar',
    fieldAnnounceChannel: 'Canal de anuncios',
    fieldDevlogChannel: 'Canal de devlogs',
    fieldBuildChannel: 'Canal de builds',
    fieldBuildRole: 'Rol para avisos de build',
    fieldTicketChannel: 'Canal de reportes de bugs',
    fieldTicketStaffRole: 'Rol del staff',
    checkTitle: 'Chequeo de configuración',
    checkDescription: 'Todo lo que el bot necesita para funcionar en este servidor.',
    checkOk: 'Listo',
    checkMissing: 'Sin configurar',
    checkNoPermission: 'Configurado, pero me faltan permisos',
  },

  welcome: {
    cardTitle: 'BIENVENIDO',
    cardSubtitle: 'Sos el miembro #{count}',
    message: '¡Hola {user}, bienvenido a **{guild}**! Pasá por las reglas y presentate.',
    messageWithGame:
      '¡Hola {user}, bienvenido a la comunidad de **{game}**! Pasá por las reglas y presentate.',
    testSent: 'Vista previa enviada.',
  },

  announce: {
    posted: 'Publicado en {channel}.',
    announcementFooter: 'Anuncio',
    devlogFooter: 'Devlog',
    devlogTitle: 'Devlog #{number} — {title}',
    modalTitleLabel: 'Título',
    modalBodyLabel: 'Contenido',
    modalImageLabel: 'URL de imagen (opcional)',
    pingEveryone: 'Esto va a mencionar a @everyone.',
  },

  build: {
    newBuild: 'Nueva build disponible',
    titleWithGame: '{game} — {version}',
    titleWithoutGame: 'Build {version}',
    fieldVersion: 'Versión',
    fieldChannel: 'Canal',
    fieldPlatforms: 'Plataformas',
    fieldChangelog: 'Cambios',
    download: 'Descargar',
    viewChangelog: 'Changelog completo',
    footerSource: 'Publicado desde {source}',
    posted: 'Build **{version}** anunciada en {channel}.',
    duplicate: 'La build **{version}** en el canal **{channel}** ya fue anunciada.',
    latestTitle: 'Última build',
    noBuilds: 'Todavía no se anunció ninguna build.',
    listTitle: 'Builds recientes',
  },

  ticket: {
    panelTitle: '¿Encontraste un bug?',
    panelDescription:
      'Tocá el botón de abajo para abrir un reporte privado. Contanos qué pasó, cómo reproducirlo y en qué build estabas — eso es lo que hace que un bug se pueda arreglar.',
    panelButton: 'Reportar un bug',
    panelPosted: 'Panel de reportes publicado en {channel}.',

    modalTitle: 'Reportar un bug',
    modalSummaryLabel: 'Resumen corto',
    modalSummaryPlaceholder: 'El juego crashea cuando abro el mapa',
    modalDetailsLabel: '¿Qué pasó? ¿Cómo lo reproducimos?',
    modalDetailsPlaceholder: '1. Empezar una partida nueva\n2. Apretar M\n3. El juego se congela',
    modalPlatformLabel: 'Plataforma (Windows / Mac / Linux / Steam Deck)',
    modalVersionLabel: 'Versión de la build (opcional)',

    created: '¡Gracias! Tu reporte es {thread} — seguimos ahí.',
    threadName: 'bug-{number}-{summary}',
    embedTitle: 'Bug #{number}: {summary}',
    fieldReporter: 'Reportado por',
    fieldPlatform: 'Plataforma',
    fieldVersion: 'Build',
    fieldStatus: 'Estado',
    openingMessage:
      '{user} gracias por el reporte. {staff} lo va a revisar. Capturas, un video o un archivo de log ayudan muchísimo — podés subirlos en este hilo.',

    buttonClose: 'Cerrar',
    buttonReopen: 'Reabrir',
    buttonClaim: 'Tomar',

    statusOpen: 'Abierto',
    statusClaimed: 'En progreso',
    statusClosed: 'Cerrado',

    resolutionFixed: 'Arreglado',
    resolutionDuplicate: 'Duplicado',
    resolutionNotABug: 'No es un bug',
    resolutionWontFix: 'No se va a arreglar',
    resolutionNoRepro: 'No se puede reproducir',

    claimed: 'Tomado por {user}.',
    closed: 'Cerrado por {user} — **{resolution}**.',
    reopened: 'Reabierto por {user}.',
    notATicket: 'Este comando solo funciona dentro del hilo de un reporte.',
    alreadyClosed: 'Este reporte ya está cerrado.',
    notClosed: 'Este reporte no está cerrado.',
    listTitle: 'Reportes abiertos',
    listEmpty: 'No hay reportes abiertos. ',
    listEntry: '**#{number}** — {summary} · <#{thread}>',
  },

  http: {
    unauthorized: 'Secreto de webhook inválido o ausente.',
    badRequest: 'Payload mal formado.',
    guildNotFound: 'Servidor desconocido, o el bot no es miembro.',
  },
};
