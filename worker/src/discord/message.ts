import type { APIEmbed } from 'discord-api-types/v10';

/** Anything with `toJSON()` — every `@discordjs/builders` builder. */
interface Serializable {
  toJSON(): unknown;
}

/**
 * The message shape handlers use. It mirrors discord.js on purpose, so the
 * command code reads the same as in the always-on bot; `toMessagePayload`
 * turns it into what Discord's API wants.
 */
export interface MessageData {
  content?: string;
  embeds?: (Serializable | APIEmbed)[];
  components?: Serializable[];
  allowedMentions?: { parse?: ('everyone' | 'roles' | 'users')[]; roles?: string[]; users?: string[] };
  /** `EPHEMERAL` for replies only the invoker sees. */
  flags?: number;
}

/** `MessageFlags.Ephemeral`, so callers need not import discord-api-types for one number. */
export const EPHEMERAL = 64;

function serialise(value: Serializable | object): unknown {
  return 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() : value;
}

export function toMessagePayload(data: MessageData | string): Record<string, unknown> {
  const message = typeof data === 'string' ? { content: data } : data;
  const payload: Record<string, unknown> = {};

  if (message.content !== undefined) payload.content = message.content;
  if (message.embeds) payload.embeds = message.embeds.map(serialise);
  if (message.components) payload.components = message.components.map(serialise);
  if (message.allowedMentions) payload.allowed_mentions = message.allowedMentions;
  if (message.flags !== undefined) payload.flags = message.flags;

  return payload;
}
