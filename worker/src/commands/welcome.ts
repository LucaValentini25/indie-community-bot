import { updateGuildConfig } from '../config/guild.js';
import { contextForUser } from '../lib/context.js';
import { EPHEMERAL } from '../discord/message.js';
import { isHttpUrl } from '../../../src/lib/text.js';
import type { Translate } from '../../../src/i18n/index.js';
import type { WorkerCommand } from './types.js';

/** Same ceiling as the always-on bot, so a link that works there works here. */
const MAX_BYTES = 8 * 1024 * 1024;

type BackgroundError = 'not-a-url' | 'unreachable' | 'not-an-image' | 'too-big';

/**
 * The welcome card is drawn with a native canvas and posted when someone joins
 * — a gateway event. Neither exists on a Worker, so the card itself is the one
 * feature this variant cannot do. The settings are still stored, so switching
 * to the always-on bot later finds them where it expects.
 */
export const welcome: WorkerCommand = {
  async execute(app, ix) {
    const guildId = ix.guildId!;
    const { s } = await contextForUser(app, guildId, ix.locale);

    if (ix.options.subcommand !== 'background') {
      await ix.reply({ content: s('welcome.needsGateway'), flags: EPHEMERAL });
      return;
    }

    await ix.deferReply({ flags: EPHEMERAL });

    if (ix.options.getBoolean('clear')) {
      await updateGuildConfig(app, guildId, { welcomeBackgroundUrl: null });
      await ix.editReply(s('welcome.backgroundCleared'));
      return;
    }

    const url = ix.options.getString('url') ?? ix.options.getAttachment('file')?.url;
    if (!url) {
      await ix.editReply(s('welcome.backgroundNothing'));
      return;
    }

    const problem = await checkImage(url);
    if (problem) {
      await ix.editReply(describeBackgroundError(problem, s));
      return;
    }

    await updateGuildConfig(app, guildId, { welcomeBackgroundUrl: url });
    await ix.editReply(`✅ ${s('welcome.backgroundSet')}\n${s('welcome.needsGateway')}`);
  },
};

/** Confirms the link is a reachable, reasonably sized image. Null means fine. */
async function checkImage(url: string): Promise<BackgroundError | null> {
  if (!isHttpUrl(url)) return 'not-a-url';

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return 'unreachable';
  }
  if (!response.ok) return 'unreachable';

  if (!response.headers.get('content-type')?.startsWith('image/')) {
    await response.body?.cancel();
    return 'not-an-image';
  }

  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) {
    await response.body?.cancel();
    return 'too-big';
  }

  // No declared length: measure what actually arrives.
  if (!declared && (await response.arrayBuffer()).byteLength > MAX_BYTES) return 'too-big';

  await response.body?.cancel();
  return null;
}

function describeBackgroundError(reason: BackgroundError, s: Translate): string {
  switch (reason) {
    case 'not-a-url':
      return s('welcome.backgroundNotUrl');
    case 'unreachable':
      return s('welcome.backgroundUnreachable');
    case 'not-an-image':
      return s('welcome.backgroundNotImage');
    case 'too-big':
      return s('welcome.backgroundTooBig');
  }
}
