import { z } from 'zod';

/**
 * Process-level configuration. Everything here comes from the environment and
 * is validated once at boot: if the shape is wrong we crash immediately with a
 * readable message instead of failing later with `undefined is not a string`.
 *
 * Per-guild settings (channels, roles, locale) do NOT belong here — they live
 * in the database and are edited at runtime with /config.
 */
const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'DISCORD_CLIENT_ID must be a Discord snowflake'),
  DISCORD_DEV_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  DATABASE_PATH: z.string().default('./data/bot.db'),

  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WEBHOOK_SECRET: z
    .string()
    .min(16, 'WEBHOOK_SECRET must be at least 16 characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),

  DEFAULT_LOCALE: z.enum(['en', 'es']).default('en'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Logger is not up yet at this point, so console is the right channel.
    console.error(
      `\nInvalid environment configuration:\n${issues}\n\nCheck your .env against .env.example.\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';
