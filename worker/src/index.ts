import { disableValidators } from '@discordjs/builders';
import { InteractionResponseType, InteractionType } from 'discord-api-types/v10';
import { Db } from './db.js';
import { Interaction, type InteractionResponse, type RawInteraction } from './discord/interaction.js';
import { botIdFromToken, Rest } from './discord/rest.js';
import { describePublicKey, verifyDiscordSignature } from './discord/verify.js';
import { handleBuildHook } from './hooks.js';
import { createLogger } from './logger.js';
import { commandNames, routeInteraction } from './router.js';
import type { App, Env } from './types.js';

const log = createLogger('worker');

// The builders validate every field with a schema library. That is a help
// while developing and a cost in production: the free plan gives ~10 ms of CPU
// per request, and Discord validates the payload again anyway.
disableValidators();

/** Fails loudly on a Worker that was deployed without its secrets. */
function missingSecrets(env: Env): string[] {
  return (['DISCORD_TOKEN', 'DISCORD_PUBLIC_KEY'] as const).filter((name) => !env[name]);
}

function createApp(env: Env): App {
  return {
    env,
    db: new Db(env.DB),
    rest: new Rest(env.DISCORD_TOKEN),
    botId: botIdFromToken(env.DISCORD_TOKEN),
    commandNames,
    memo: new Map(),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function handleInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();

  const valid = await verifyDiscordSignature(
    env.DISCORD_PUBLIC_KEY,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
    body,
  );
  if (!valid) {
    // Discord deliberately sends one bad signature when you save the endpoint
    // URL, so a single rejection is normal. Two in a row with a key that is not
    // 64 hex characters is a misconfigured secret.
    log.warn({ publicKey: describePublicKey(env.DISCORD_PUBLIC_KEY) }, 'rejected an interaction signature');
    return new Response('invalid request signature', { status: 401 });
  }

  const payload = JSON.parse(body) as RawInteraction;

  // Discord pings the endpoint when the URL is saved, and from time to time after.
  if (payload.type === InteractionType.Ping) return json(200, { type: InteractionResponseType.Pong });

  const app = createApp(env);
  const ix = new Interaction(payload, app.rest);

  // The handler keeps running after we answer — sending the real message,
  // creating a thread — so it is handed to `waitUntil` rather than awaited.
  const finished = routeInteraction(app, ix);
  ctx.waitUntil(finished);

  // Discord wants an answer in 3 seconds; whatever the handler answers first *is* the response.
  // If the handler ends without answering (the database being down is the
  // usual reason, since even the error reply reads it), say so rather than
  // leaving Discord to time out.
  const first = await Promise.race([
    ix.firstResponse,
    finished.then((): InteractionResponse => ({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: 'Something went wrong.', flags: 64 },
    })),
  ]);
  return json(200, first);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        const missing = missingSecrets(env);
        return json(missing.length === 0 ? 200 : 503, {
          status: missing.length === 0 ? 'ok' : 'misconfigured',
          mode: 'serverless',
          ...(missing.length > 0 ? { missingSecrets: missing } : {}),
        });
      }

      if (missingSecrets(env).length > 0) return json(503, { error: 'misconfigured' });

      if (request.method === 'POST' && url.pathname === '/interactions') {
        return await handleInteraction(request, env, ctx);
      }

      if (request.method === 'POST' && url.pathname === '/hooks/build') {
        return await handleBuildHook(createApp(env), request);
      }

      return json(404, { error: 'not_found' });
    } catch (error) {
      log.error({ err: error, path: url.pathname }, 'unhandled error');
      return json(500, { error: 'internal_error' });
    }
  },
} satisfies ExportedHandler<Env>;
