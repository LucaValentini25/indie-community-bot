import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ClientEvents,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

/** Any of the builder shapes `SlashCommandBuilder` narrows into as you chain. */
export type AnySlashCommandBuilder =
  SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  /** The command definition sent to Discord's API. */
  readonly data: AnySlashCommandBuilder;
  /** Runs on `/command`. Throwing here is safe: the router replies with a generic error and logs. */
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Optional autocomplete handler for this command's options. */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  readonly name: K;
  readonly once?: boolean;
  execute(...args: ClientEvents[K]): Promise<void> | void;
}

/** Helper that keeps `args` typed against the event name at the call site. */
export function defineEvent<K extends keyof ClientEvents>(handler: EventHandler<K>): EventHandler<K> {
  return handler;
}
