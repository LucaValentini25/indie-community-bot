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
    botNotInServer:
      'No soy miembro de este servidor: solo me instalaron para los comandos, así que no puedo leer ni publicar nada. Invitame de nuevo con un link que incluya el permiso `bot`.',
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
    fieldSecondLocale: 'Segundo idioma',
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
    fieldSecondaryChannel: '(2º idioma)',
    checkNoPermission: 'Configurado, pero me faltan permisos',
    fieldServerAvatar: 'Avatar del servidor',
    fieldServerBanner: 'Portada del servidor',
    fieldServerNickname: 'Apodo acá',
    sectionIdentity: 'Apariencia en este servidor',
    brandingUpdated: 'Se actualizó **{fields}**.',
    brandingScopeNote: 'Esto cambia solo cómo me veo en este servidor. Mi imagen en el resto queda igual.',
    brandingCleared: 'Listo. Vuelvo a mi apariencia por defecto en este servidor.',
    brandingNothing: 'No hay nada que cambiar — adjuntá un avatar o una portada, o pasá un apodo.',
    brandingNotImage: '`{file}` no es una imagen.',
    brandingTooBig: 'Esa imagen pasa los 10 MB. Discord no la va a aceptar.',
    brandingDownloadFailed: 'No pude descargar ese adjunto. Probá subirlo de nuevo.',
    brandingNoPermission: 'Necesito el permiso **Cambiar apodo** para renombrarme acá.',
    brandingRejected:
      'Discord rechazó esa imagen. Los avatares piden PNG o JPG cuadrado; los animados suelen ser rechazados.',
  },

  access: {
    title: 'Acceso a los comandos',
    description: 'Qué roles pueden usar cada comando en **{guild}**.',
    everyCommand: 'Todos los comandos',
    everythingElse: 'Todo lo demás',
    discordDefault: 'quien los permisos de Discord permitan',
    noRules:
      'Todavía no hay restricciones. Cada comando depende solo de los permisos de Discord. Usá `/access allow` para limitar uno a roles concretos.',
    allowed: '{role} ya puede usar **{command}**.',
    alreadyAllowed: '{role} ya podía usar **{command}**.',
    revoked: '{role} ya no puede usar **{command}**.',
    notAllowed: 'No había ninguna regla que le diera acceso a {role} sobre **{command}**.',
    cleared: 'Se borraron {count} regla(s) de **{command}**.',
    nothingToClear: 'No había nada que borrar en **{command}**.',
    unknownCommand: 'No existe ningún comando llamado **{command}**.',
    selfLocked:
      '`/access` siempre es solo para administradores — restringirlo podría dejar al servidor afuera de su propio bot.',
    overridesWildcard:
      '⚠️ La lista propia de un comando reemplaza a la de todos los comandos, así que los roles de **Todos los comandos** ya no llegan a **{command}**. Agregalos acá también si corresponde.',
    denied: 'Este comando está limitado a {roles}.',
    footer:
      'Los administradores y el dueño del servidor siempre pasan. Estas reglas achican los permisos de Discord, nunca los amplían.',
  },

  selfrole: {
    panelTitle: 'Elegí tus roles',
    panelDescription: 'Tocá un botón para darte un rol. Tocalo de nuevo para sacártelo.',
    added: 'Ya tenés {role}.',
    removed: 'Ya no tenés {role}.',
    unavailable:
      'Ese rol ya no está disponible. Este panel quedó viejo — pedile a un admin que publique uno nuevo.',
    listTitle: 'Roles autoasignables',
    listEmpty:
      'Todavía ninguno. Agregá uno con `/selfrole add` y después publicá el panel con `/selfrole panel`.',
    listCount: '{count} de {max} lugares usados.',
    addedRule: '{role} ya se puede autoasignar.',
    updatedRule: 'Se actualizó {role}.',
    removedRule: '{role} ya no se puede autoasignar.',
    notInList: '{role} no estaba en el panel.',
    roleGone: 'este rol ya no existe',
    repostReminder:
      'Corré `/selfrole panel` para publicar el panel actualizado — los mensajes ya publicados conservan los botones viejos.',
    full: 'Un panel admite hasta {max} roles, que es el límite de Discord de cinco botones por cinco filas.',
    invalidEmoji:
      '`{emoji}` no es algo que pueda poner en un botón. Usá un solo emoji, o uno personalizado como `<:nombre:id>`.',
    managedRole: '{role} lo administra una integración o un bot, así que no se le puede dar a nadie a mano.',
    everyoneRole: '@everyone no es un rol al que alguien pueda sumarse.',
    needManageRoles: 'Necesito el permiso **Gestionar roles** antes de poder repartir cualquier rol.',
    aboveMe:
      'Mi propio rol tiene que estar por encima de {role} para poder asignarlo. Subilo en Configuración del servidor → Roles.',
    panelPosted: 'Panel publicado en {channel}.',
    panelEmpty: 'Agregá al menos un rol con `/selfrole add` antes de publicar el panel.',
  },

  welcome: {
    cardTitle: 'BIENVENIDO',
    cardSubtitle: 'Sos el miembro #{count}',
    message: '¡Hola {user}, bienvenido a **{guild}**! Pasá por las reglas y presentate.',
    messageWithGame:
      '¡Hola {user}, bienvenido a la comunidad de **{game}**! Pasá por las reglas y presentate.',
    testSent: 'Vista previa enviada.',
    backgroundSet: 'Arte de la bienvenida actualizado para este servidor.',
    backgroundPreviewHint: 'Corré `/welcome test` para verlo.',
    backgroundCleared: 'Vuelve el arte por defecto.',
    backgroundNothing: 'Pasá `url:`, adjuntá un `file:`, o usá `clear:true`.',
    backgroundNotUrl: 'Eso no es un link http(s) válido.',
    backgroundUnreachable:
      'No pude descargar esa imagen. Fijate que el link sea público y directo — la página donde está no sirve, tenés que pasar la imagen en sí.',
    backgroundNotImage: 'Ese link no apunta a una imagen.',
    backgroundTooBig: 'Esa imagen pasa los 8 MB. Redimensionala — la tarjeta mide 1000x350.',
    backgroundUndecodable: 'La descargué pero no pude leerla como imagen. PNG, JPG o WebP.',
    needsGateway:
      'Esto necesita la versión del bot siempre encendida para generar la tarjeta, así que no está disponible en modo serverless. Todo lo demás funciona.',
  },

  announce: {
    noContent: 'No hay nada para publicar: no se escribió texto en ninguno de los idiomas del servidor.',
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

    closePrompt: '¿Cómo se resolvió?',
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
