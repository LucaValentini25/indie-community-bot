/**
 * Renders sample welcome cards to `preview/` so the design can be iterated on
 * without a Discord connection, a server, or a single test join.
 *
 *   npm run preview:card
 *   npm run preview:card -- "#FF5C00" "My Game"
 *
 * The card module reaches the logger, which validates the full environment on
 * import. Filling in throwaway credentials here keeps this script runnable
 * before `.env` exists — it never talks to Discord.
 */
process.env.DISCORD_TOKEN ??= 'preview';
process.env.DISCORD_CLIENT_ID ??= '000000000000000000';
process.env.LOG_LEVEL ??= 'warn';

const { mkdirSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { renderWelcomeCard, registerFonts } = await import('../features/welcome/card.js');

const accent = process.argv[2] ?? '#FF5C00';
const gameName = process.argv[3] ?? 'My Indie Game';

const samples = [
  { file: 'en-short.png', username: 'lucav', title: 'WELCOME', subtitle: 'You are member #142' },
  { file: 'es-short.png', username: 'lucav', title: 'BIENVENIDO', subtitle: 'Sos el miembro #142' },
  {
    file: 'long-name.png',
    username: 'un_nombre_muy_largo_de_verdad',
    title: 'BIENVENIDO',
    subtitle: 'Sos el miembro #13370',
  },
];

registerFonts();

const outputDir = join(process.cwd(), 'preview');
mkdirSync(outputDir, { recursive: true });

for (const [index, sample] of samples.entries()) {
  const png = await renderWelcomeCard({
    username: sample.username,
    // Discord's built-in default avatars — no account or token needed.
    avatarUrl: `https://cdn.discordapp.com/embed/avatars/${index % 6}.png`,
    title: sample.title,
    subtitle: sample.subtitle,
    footer: gameName,
    accentColor: accent,
  });

  writeFileSync(join(outputDir, sample.file), png);
  console.log(`preview/${sample.file}  (${(png.length / 1024).toFixed(0)} KB)`);
}

console.log(`\nAccent: ${accent} · Game: ${gameName}`);
console.log('Drop artwork at assets/welcome/background.png to use it as the card background.');
