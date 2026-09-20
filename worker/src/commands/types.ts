import type { Interaction } from '../discord/interaction.js';
import type { App } from '../types.js';

/**
 * A command's behaviour. Its *definition* — name, options, localisations — is
 * the one in `src/commands/`, registered with `npm run commands:deploy`. Only
 * the handler is reimplemented here, so there is a single source of truth for
 * what Discord shows in the command picker.
 */
export interface WorkerCommand {
  execute(app: App, ix: Interaction): Promise<void>;
  autocomplete?(app: App, ix: Interaction): Promise<void>;
}
