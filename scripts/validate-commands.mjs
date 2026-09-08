/**
 * Validates every slash command definition against Discord's API limits.
 *
 * Discord rejects a malformed command with an opaque 400 at registration time,
 * which is a slow and confusing way to find out that a description is 103
 * characters long. This runs in CI against the compiled output and fails fast
 * with the offending command named.
 *
 *   node scripts/validate-commands.mjs
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

// The command modules import the logger, which validates the environment.
process.env.DISCORD_TOKEN ??= 'validate';
process.env.DISCORD_CLIENT_ID ??= '000000000000000000';
process.env.LOG_LEVEL ??= 'silent';

const COMMANDS_DIR = join(process.cwd(), 'dist', 'commands');

const LIMITS = {
  nameLength: 32,
  descriptionLength: 100,
  options: 25,
  choices: 25,
};

const NAME_PATTERN = /^[-_'\p{Ll}\p{Lm}\p{Lo}\p{N}\p{sc=Devanagari}\p{sc=Thai}]{1,32}$/u;

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function validateOption(commandName, option, path) {
  const where = `${commandName} → ${path}`;

  check(NAME_PATTERN.test(option.name), `${where}: invalid option name "${option.name}"`);
  check(
    option.description.length <= LIMITS.descriptionLength,
    `${where}: description is ${option.description.length} chars (max ${LIMITS.descriptionLength})`,
  );

  if (option.choices) {
    check(
      option.choices.length <= LIMITS.choices,
      `${where}: ${option.choices.length} choices (max ${LIMITS.choices})`,
    );
  }

  for (const nested of option.options ?? []) {
    validateOption(commandName, nested, `${path}.${nested.name}`);
  }

  // Discord requires every required option to come before optional ones.
  const nested = option.options ?? [];
  const firstOptional = nested.findIndex((child) => !child.required && child.type <= 11);
  const lastRequired = nested.findLastIndex((child) => child.required);
  check(
    firstOptional === -1 || lastRequired === -1 || lastRequired < firstOptional,
    `${where}: required options must be declared before optional ones`,
  );
}

const files = await readdir(COMMANDS_DIR, { recursive: true }).catch(() => {
  console.error(`No compiled commands found at ${COMMANDS_DIR}. Run "npm run build" first.`);
  process.exit(1);
});

const seen = new Set();
let count = 0;

for (const file of files.sort()) {
  if (extname(file) !== '.js') continue;

  const module = await import(pathToFileURL(join(COMMANDS_DIR, file)).href);
  const command = module.default;

  if (!command?.data) {
    problems.push(`${file}: no default export with a "data" property`);
    continue;
  }

  let json;
  try {
    json = command.data.toJSON();
  } catch (error) {
    problems.push(`${file}: builder rejected the definition — ${error.message}`);
    continue;
  }

  count += 1;

  check(!seen.has(json.name), `duplicate command name "${json.name}"`);
  seen.add(json.name);

  check(NAME_PATTERN.test(json.name), `${json.name}: invalid command name`);
  check(
    json.description.length <= LIMITS.descriptionLength,
    `${json.name}: description is ${json.description.length} chars (max ${LIMITS.descriptionLength})`,
  );
  check(
    (json.options ?? []).length <= LIMITS.options,
    `${json.name}: ${json.options.length} options (max ${LIMITS.options})`,
  );

  for (const option of json.options ?? []) {
    validateOption(json.name, option, option.name);
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) found:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ ${count} command definition(s) valid.`);
