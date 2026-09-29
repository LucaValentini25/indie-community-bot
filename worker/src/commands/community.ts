import { showPostModal, type PostKind } from '../features/posts.js';
import { isLocale } from '../../../src/i18n/index.js';
import type { WorkerCommand } from './types.js';

/** `/announce` and `/devlog` differ only in the kind of post they open. */
function postCommand(kind: PostKind): WorkerCommand {
  return {
    async execute(app, ix) {
      const only = ix.options.getString('language');
      await showPostModal(
        app,
        ix,
        kind,
        ix.options.getBoolean('ping') ?? false,
        only && isLocale(only) ? only : null,
      );
    },
  };
}

export const announce = postCommand('announcement');
export const devlog = postCommand('devlog');
