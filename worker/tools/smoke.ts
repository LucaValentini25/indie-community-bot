/**
 * End-to-end smoke test of the Worker, with nothing mocked inside it.
 *
 * What is real: the Worker's own `fetch` handler, Ed25519 signature checking,
 * the router, every feature, and the exact `worker/migrations/*.sql` that get
 * applied to production. What is stood in for: D1 (a `node:sqlite` database
 * behind the same interface) and Discord's REST API (a recording fake).
 *
 *   npm run worker:test
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────
const GUILD = '100000000000000001';
const APP = '900000000000000001'; // application id == bot user id
const CH_ANN = '200000000000000001';
const CH_BUGS = '200000000000000002';
const CH_BUILDS = '200000000000000003';
const ROLE_STAFF = '300000000000000001';
const ROLE_PLAY = '300000000000000002'; // below the bot: assignable
const ROLE_HIGH = '300000000000000003'; // above the bot: not assignable
const ROLE_BOT = '300000000000000009';
const ADMIN = '400000000000000001';
const REGULAR = '400000000000000002';

const P = {
  admin: 8n,
  manageMessages: 1n << 13n,
  manageThreads: 1n << 34n,
  // View, Send, EmbedLinks, AttachFiles, ManageRoles, CreatePrivateThreads, SendInThreads
  botBase: (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 28n) | (1n << 36n) | (1n << 38n),
};

// ── Ed25519 keys, as Discord would issue them ───────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// Pure-JS hex: with both Node's and Cloudflare's typings loaded, Buffer#toString
// resolves to the wrong overload.
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const publicKeyHex = toHex(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));

// A bot token begins with the bot's id in base64.
const token = `${Buffer.from(APP).toString('base64')}.fake.token`;

// ── D1 stand-in over node:sqlite ────────────────────────────────────────────
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync(join(import.meta.dirname, '..', 'migrations')).sort()) {
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'migrations', file), 'utf8'));
}

function d1(): D1Database {
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...values: SQLInputValue[]) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params), meta: {} }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

const env: Env = {
  DB: d1(),
  DISCORD_TOKEN: token,
  DISCORD_PUBLIC_KEY: publicKeyHex,
  WEBHOOK_SECRET: 'a-webhook-secret-long-enough',
  DEFAULT_LOCALE: 'en',
};

// ── Discord's REST API, faked and recorded ──────────────────────────────────
interface Call {
  method: string;
  path: string;
  body: any;
}
let calls: Call[] = [];
let nextId = 5000;
let threadMessages: any[] = [];

const roles = [
  { id: GUILD, name: '@everyone', permissions: String(P.botBase), position: 0, managed: false },
  { id: ROLE_PLAY, name: 'Playtester', permissions: '0', position: 1, managed: false },
  { id: ROLE_STAFF, name: 'Staff', permissions: '0', position: 2, managed: false },
  { id: ROLE_BOT, name: 'Bot', permissions: String(P.botBase), position: 5, managed: true },
  { id: ROLE_HIGH, name: 'Boss', permissions: '0', position: 9, managed: false },
];

function channel(id: string, type = 0) {
  return { id, type, guild_id: GUILD, name: `chan-${id.slice(-1)}`, permission_overwrites: [] as unknown[] };
}
const channels: Record<string, ReturnType<typeof channel>> = {
  [CH_ANN]: channel(CH_ANN),
  [CH_BUGS]: channel(CH_BUGS),
  [CH_BUILDS]: channel(CH_BUILDS),
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = url.pathname.replace('/api/v10', '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });

  const ok = (data: unknown, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(data), { status });
  const notFound = () => ok({ code: 10003, message: 'Unknown Channel' }, 404);

  let match: RegExpMatchArray | null;
  if (method === 'GET' && path === `/guilds/${GUILD}`) return ok({ id: GUILD, name: 'Test Server' });
  // Any other guild is one the bot was never added to (installed for commands only).
  if (method === 'GET' && /^\/guilds\/\d+$/.test(path))
    return ok({ code: 10004, message: 'Unknown Guild' }, 404);
  if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return ok(roles);
  if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP}`) {
    return ok({ roles: [ROLE_BOT], nick: null, avatar: null, user: { id: APP } });
  }
  if (method === 'PATCH' && path === `/guilds/${GUILD}/members/@me`) return ok({ roles: [ROLE_BOT] });
  if ((match = path.match(/^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/))) return ok(null, 204);

  if ((match = path.match(/^\/channels\/(\d+)$/))) {
    if (method === 'PATCH') return ok({ id: match[1] });
    const found = channels[match[1]!];
    return found ? ok(found) : notFound();
  }
  if ((match = path.match(/^\/channels\/(\d+)\/messages$/))) {
    if (method === 'GET') return ok(threadMessages);
    return ok({ id: String(nextId++), channel_id: match[1] });
  }
  if ((match = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/))) return ok({ id: match[2] });
  if ((match = path.match(/^\/channels\/(\d+)\/threads$/))) {
    return ok({ id: '700000000000000001', type: 12, parent_id: match[1] });
  }
  if (path.match(/^\/channels\/\d+\/thread-members\/\d+$/)) return ok(null, 204);
  if (path.startsWith(`/webhooks/${APP}/`)) return ok({ id: String(nextId++) });

  return ok({ code: 0, message: `fake has no route for ${method} ${path}` }, 404);
}) as typeof fetch;

// ── Sending interactions ────────────────────────────────────────────────────
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) } as ExecutionContext;

/** Calls the Worker the way the runtime would. Node's Request lacks Cloudflare's `cf` typing. */
const invoke = (request: Request, environment: Env = env) => worker.fetch(request as never, environment, ctx);

/** Lets everything the handler kept doing after answering finish. */
async function settle() {
  while (pending.length) await Promise.all(pending.splice(0));
}

function signed(body: string, key = privateKey): Request {
  const timestamp = String(Date.now());
  const signature = toHex(sign(null, Buffer.from(timestamp + body), key));
  return new Request('https://bot.example/interactions', {
    method: 'POST',
    body,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  });
}

interface Who {
  id: string;
  roles?: string[];
  permissions: bigint;
  locale?: string;
}
const admin: Who = { id: ADMIN, permissions: P.admin };
const staff: Who = { id: ADMIN, roles: [ROLE_STAFF], permissions: P.manageMessages | P.manageThreads };
const regular: Who = { id: REGULAR, permissions: 0n };

let counter = 0;
function raw(who: Who, type: number, data: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: `id${++counter}`,
    application_id: APP,
    type,
    token: `token${counter}`,
    guild_id: GUILD,
    channel_id: CH_ANN,
    channel: { id: CH_ANN, type: 0 },
    locale: who.locale ?? 'en-US',
    member: {
      user: { id: who.id, username: 'luca', discriminator: '0', avatar: null },
      roles: who.roles ?? [],
      permissions: String(who.permissions),
      nick: null,
    },
    data,
    ...extra,
  };
}

async function send(payload: unknown, request?: Request) {
  const response = await invoke(request ?? signed(JSON.stringify(payload)));
  const text = await response.text();
  await settle();
  return { status: response.status, json: text.startsWith('{') ? JSON.parse(text) : text };
}

/** `/name sub key:value ...`; options are typed by the value they carry. */
function command(who: Who, name: string, sub: string | null, options: Record<string, unknown> = {}) {
  const list = Object.entries(options).map(([key, value]) => ({
    name: key,
    type: typeof value === 'boolean' ? 5 : key.match(/^(role|join|builds|staff)$/) ? 8 : 3,
    value,
  }));
  return raw(who, 2, {
    id: 'cmd',
    name,
    type: 1,
    options: sub ? [{ type: 1, name: sub, options: list }] : list,
    resolved: {
      roles: Object.fromEntries(roles.map((role) => [role.id, role])),
    },
  });
}

const button = (who: Who, customId: string, extra = {}) =>
  raw(who, 3, { custom_id: customId, component_type: 2 }, extra);

const modalSubmit = (who: Who, customId: string, fields: Record<string, string>) =>
  raw(who, 5, {
    custom_id: customId,
    components: Object.entries(fields).map(([id, value]) => ({
      type: 1,
      components: [{ type: 4, custom_id: id, value }],
    })),
  });

const called = (method: string, pathPart: string | RegExp) =>
  calls.filter(
    (c) =>
      c.method === method &&
      (typeof pathPart === 'string' ? c.path.includes(pathPart) : pathPart.test(c.path)),
  );

// ── The tests ───────────────────────────────────────────────────────────────
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  calls = [];
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

console.log('worker smoke test');

await test('health check reports ok', async () => {
  const response = await invoke(new Request('https://bot.example/health'));
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { status: string }).status, 'ok');
});

await test('a missing secret is reported, not hidden', async () => {
  const response = await invoke(new Request('https://bot.example/health'), {
    ...env,
    DISCORD_PUBLIC_KEY: '',
  });
  assert.equal(response.status, 503);
});

await test('rejects an interaction with a bad signature', async () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  const { status } = await send(null, signed(JSON.stringify({ type: 1 }), other));
  assert.equal(status, 401);
});

await test('rejects an interaction with no signature at all', async () => {
  const request = new Request('https://bot.example/interactions', { method: 'POST', body: '{"type":1}' });
  assert.equal((await send(null, request)).status, 401);
});

await test('answers Discord ping with pong', async () => {
  const { status, json } = await send({ type: 1 });
  assert.equal(status, 200);
  assert.deepEqual(json, { type: 1 });
});

await test('/config channels stores the channel and confirms', async () => {
  const { json } = await send(
    command(admin, 'config', 'channels', { announcements: CH_ANN, builds: CH_BUILDS, bugs: CH_BUGS }),
  );
  assert.equal(json.type, 5, 'acknowledged with a deferred reply first');
  const edit = called('PATCH', '@original')[0]!;
  assert.match(edit.body.content, /Announcements/);
  assert.equal(edit.body.embeds[0].title, 'Server configuration');
  const row = sqlite.prepare('SELECT announce_channel_id, build_channel_id FROM guild_config').get() as any;
  assert.equal(row.announce_channel_id, CH_ANN);
  assert.equal(row.build_channel_id, CH_BUILDS);
});

await test('/config check finds a usable channel and a missing one', async () => {
  await send(command(admin, 'config', 'check'));
  const description = called('PATCH', '@original')[0]!.body.embeds[0].description as string;
  assert.match(description, /🟢 \*\*.*Announcements?/i);
  assert.match(description, /⚪/, 'the devlog channel is not configured');
});

await test('/config check flags a channel the bot cannot post in', async () => {
  channels[CH_BUILDS]!.permission_overwrites = [{ id: GUILD, type: 0, allow: '0', deny: String(1n << 11n) }];
  await send(command(admin, 'config', 'check'));
  const description = called('PATCH', '@original')[0]!.body.embeds[0].description as string;
  assert.match(description, /🔴.*SendMessages/s);
  channels[CH_BUILDS]!.permission_overwrites = [];
});

await test('/announce opens a modal carrying its state in the custom id', async () => {
  const { json } = await send(command(staff, 'announce', null, { ping: false }));
  assert.equal(json.type, 9);
  assert.equal(json.data.custom_id, 'post:modal:announcement:0:en');
});

await test('submitting the announcement modal posts an embed and records it', async () => {
  const { json } = await send(
    modalSubmit(staff, 'post:modal:announcement:0:en', {
      title_en: 'Patch 0.4',
      body_en: 'New things',
      image: '',
    }),
  );
  assert.equal(json.type, 5);
  const post = called('POST', `/channels/${CH_ANN}/messages`)[0]!;
  assert.equal(post.body.embeds[0].title, 'Patch 0.4');
  assert.deepEqual(post.body.allowed_mentions, { parse: [] }, 'no stray pings');
  assert.match(called('PATCH', '@original')[0]!.body.content, new RegExp(CH_ANN));
  const rows = sqlite.prepare('SELECT title, kind FROM posts').all() as any[];
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Patch 0.4'],
  );
});

await test('@everyone only fires when the author asked for it', async () => {
  await send(
    modalSubmit(staff, 'post:modal:announcement:1:en', { title_en: 'Big news', body_en: 'x', image: '' }),
  );
  const post = called('POST', `/channels/${CH_ANN}/messages`)[0]!;
  assert.equal(post.body.content, '@everyone');
  assert.deepEqual(post.body.allowed_mentions, { parse: ['everyone'] });
});

await test('/devlog numbers entries per server', async () => {
  await send(modalSubmit(staff, 'post:modal:devlog:0:en', { title_en: 'Week 1', body_en: 'x', image: '' }));
  await send(modalSubmit(staff, 'post:modal:devlog:0:en', { title_en: 'Week 2', body_en: 'x', image: '' }));
  const titles = called('POST', `/channels/${CH_ANN}/messages`).map((c) => c.body.embeds[0].title);
  assert.match(titles[0], /#1/);
  assert.match(titles[1], /#2/);
});

await test('a second language is rendered as a second embed in one message', async () => {
  await send(command(admin, 'config', 'general', { second_language: 'es' }));
  calls = [];
  const { json } = await send(command(staff, 'announce', null, {}));
  assert.equal(json.data.custom_id, 'post:modal:announcement:0:en,es');
  await send(
    modalSubmit(staff, 'post:modal:announcement:0:en,es', {
      title_en: 'Hello',
      body_en: 'a',
      title_es: 'Hola',
      body_es: 'b',
      image: '',
    }),
  );
  const post = called('POST', `/channels/${CH_ANN}/messages`)[0]!;
  assert.equal(post.body.embeds.length, 2);
  assert.equal(post.body.embeds[1].title, 'Hola');
  await send(command(admin, 'config', 'reset', { setting: 'secondaryLocale' }));
});

await test('/build announce posts, records, and refuses a duplicate', async () => {
  await send(command(staff, 'build', 'announce', { version: '0.4.2', notes: 'Fixed the crash' }));
  const post = called('POST', `/channels/${CH_BUILDS}/messages`)[0]!;
  assert.match(post.body.embeds[0].title, /0\.4\.2/);
  assert.match(called('PATCH', '@original')[0]!.body.content, /announced/i);

  calls = [];
  await send(command(staff, 'build', 'announce', { version: '0.4.2' }));
  assert.equal(called('POST', '/messages').length, 0, 'nothing posted the second time');
  assert.match(called('PATCH', '@original')[0]!.body.content, /already/i);
});

await test('/build latest reads it back', async () => {
  const { json } = await send(command(staff, 'build', 'latest'));
  assert.equal(json.data.embeds[0].fields[0].value, '`0.4.2`');
});

await test('the CI webhook announces a build, and a re-run is a no-op', async () => {
  const hook = (secret: string | null, version: string) =>
    new Request('https://bot.example/hooks/build', {
      method: 'POST',
      headers: secret ? { 'x-webhook-secret': secret } : {},
      body: JSON.stringify({ guildId: GUILD, version, channel: 'beta' }),
    });

  let response = await invoke(hook('a-webhook-secret-long-enough', '1.0.0'));
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as any).status, 'announced');

  response = await invoke(hook('a-webhook-secret-long-enough', '1.0.0'));
  assert.equal(((await response.json()) as any).status, 'already_announced');

  assert.equal((await invoke(hook('wrong-secret-wrong-secret', '1.0.1'))).status, 401);
  assert.equal((await invoke(hook(null, '1.0.1'))).status, 401);
});

await test('/access narrows a command to a role, and says which', async () => {
  await send(command(admin, 'access', 'allow', { command: 'build', role: ROLE_STAFF }));
  assert.match(called('PATCH', '@original')[0]!.body.content, /✅/);

  // A member with Manage Messages but not the Staff role is now refused…
  const outsider: Who = { id: REGULAR, permissions: P.manageMessages };
  calls = [];
  const { json } = await send(command(outsider, 'build', 'list'));
  assert.equal(json.type, 4);
  assert.match(json.data.content, new RegExp(ROLE_STAFF));

  // …the role holder and an Administrator still pass.
  assert.equal((await send(command(staff, 'build', 'list'))).json.data.embeds[0].title.length > 0, true);
  assert.equal((await send(command(admin, 'build', 'list'))).json.type, 4);

  await send(command(admin, 'access', 'clear', { command: 'build' }));
});

await test('/access will not gate itself', async () => {
  await send(command(admin, 'access', 'allow', { command: 'access', role: ROLE_STAFF }));
  assert.match(called('PATCH', '@original')[0]!.body.content, /access/i);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM command_access WHERE command = 'access'").get()!.n,
    0,
  );
});

await test('a bug report opens a private thread and a ticket', async () => {
  const opened = await send(button(regular, 'ticket:open'));
  assert.equal(opened.json.type, 9);

  await send(
    modalSubmit(regular, 'ticket:modal', {
      summary: 'Crash on load',
      details: 'It crashes',
      platform: 'Windows',
      version: '0.4.2',
    }),
    undefined,
  );
  const thread = called('POST', `/channels/${CH_BUGS}/threads`)[0]!;
  assert.equal(thread.body.type, 12, 'private thread');
  assert.equal(thread.body.invitable, false);
  const opening = called('POST', '/channels/700000000000000001/messages')[0]!;
  assert.match(opening.body.embeds[0].title, /#1/);
  assert.equal(opening.body.components[0].components.length, 2, 'claim and close');
  const ticket = sqlite.prepare('SELECT number, status FROM tickets').get() as any;
  assert.deepEqual({ ...ticket }, { number: 1, status: 'open' });
});

await test('staff can claim it; a random member cannot', async () => {
  const denied = await send(button(regular, 'ticket:claim:1'));
  assert.equal(denied.json.type, 4);
  assert.match(denied.json.data.content, /permission/i);

  calls = [];
  const claimed = await send(button(staff, 'ticket:claim:1'));
  assert.equal(claimed.json.type, 7, 'edits the ticket message in place');
  assert.match(claimed.json.data.embeds[0].fields.at(-1).value, /In progress/i);
  assert.equal(called('POST', '/webhooks/').length, 1, 'and announces the claim');
});

await test('closing asks for a resolution, then archives the thread', async () => {
  const request = await send(button(staff, 'ticket:close:1'));
  assert.equal(request.json.type, 4);
  assert.equal(request.json.data.components[0].components[0].options.length, 5);

  threadMessages = [{ id: '800000000000000001', author: { id: APP }, embeds: [{}] }];
  calls = [];
  const resolved = await send(
    raw(
      staff,
      3,
      { custom_id: 'ticket:resolve:1', component_type: 3, values: ['fixed'] },
      { channel: { id: '700000000000000001', type: 12 }, channel_id: '700000000000000001' },
    ),
  );
  assert.equal(resolved.json.type, 7);
  assert.equal(called('PATCH', '/messages/800000000000000001').length, 1, 'ticket embed refreshed');
  assert.equal(called('PATCH', /channels\/700000000000000001$/).at(0)!.body.archived, true);
  assert.equal((sqlite.prepare('SELECT status, resolution FROM tickets').get() as any).resolution, 'fixed');
});

await test('/bug panel posts the report button in the bug channel', async () => {
  await send(command(staff, 'bug', 'panel'));
  const post = called('POST', `/channels/${CH_BUGS}/messages`)[0]!;
  assert.equal(post.body.components[0].components[0].custom_id, 'ticket:open');
});

await test('/selfrole refuses a role above the bot, accepts one below it', async () => {
  await send(command(admin, 'selfrole', 'add', { role: ROLE_HIGH, label: 'Boss' }));
  assert.match(called('PATCH', '@original')[0]!.body.content, /above|higher|hierarchy/i);

  calls = [];
  await send(command(admin, 'selfrole', 'add', { role: ROLE_PLAY, label: 'Playtester', emoji: '🎮' }));
  assert.match(called('PATCH', '@original')[0]!.body.content, /✅/);

  calls = [];
  await send(
    command(admin, 'selfrole', 'add', { role: ROLE_PLAY, label: 'Playtester', emoji: 'not an emoji' }),
  );
  assert.doesNotMatch(called('PATCH', '@original')[0]!.body.content, /✅/);
});

await test('the role panel button toggles the role on and off', async () => {
  await send(command(admin, 'selfrole', 'panel', { channel: CH_ANN }));
  const panel = called('POST', `/channels/${CH_ANN}/messages`)[0]!;
  assert.equal(panel.body.components[0].components[0].custom_id, `selfrole:toggle:${ROLE_PLAY}`);

  calls = [];
  await send(button(regular, `selfrole:toggle:${ROLE_PLAY}`));
  assert.equal(called('PUT', `/roles/${ROLE_PLAY}`).length, 1);

  calls = [];
  await send(button({ ...regular, roles: [ROLE_PLAY] }, `selfrole:toggle:${ROLE_PLAY}`));
  assert.equal(called('DELETE', `/roles/${ROLE_PLAY}`).length, 1);
});

await test('a self-role click for a role no longer on the panel does nothing', async () => {
  await send(button(regular, `selfrole:toggle:${ROLE_HIGH}`));
  assert.equal(called('PUT', '/roles/').length, 0);
});

await test('/welcome test says it needs the always-on bot', async () => {
  const { json } = await send(command(admin, 'welcome', 'test'));
  assert.equal(json.type, 4);
  assert.match(json.data.content, /always-on/);
});

await test('ephemeral replies follow the viewer language', async () => {
  const { json } = await send(command({ ...staff, locale: 'es-419' }, 'build', 'latest'));
  assert.match(JSON.stringify(json.data.embeds[0]), /[Úú]ltima|Versi/);
});

await test('a server the bot is not a member of gets an explanation, not "something went wrong"', async () => {
  // The app was installed with only the applications.commands scope: `/` works,
  // but every API call about the guild answers 404 Unknown Guild.
  const foreign = {
    ...command({ ...admin, locale: 'es-419' }, 'config', 'view'),
    guild_id: '100000000000000999',
  };
  const { json } = await send(foreign);
  assert.equal(json.type, 5);
  const reply = called('PATCH', '@original').at(-1)!.body.content as string;
  assert.match(reply, /No soy miembro/);
  assert.match(reply, /`bot`/);
});

await test('an unknown command gets an answer instead of silence', async () => {
  const { json } = await send(raw(admin, 2, { id: 'x', name: 'nope', type: 1 }));
  assert.equal(json.type, 4);
});

console.log(`\n${passed} passed`);
