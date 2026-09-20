import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandInteractionDataOption,
  type APIAttachment,
  type APIInteractionDataResolved,
  type APIRole,
  type APIUser,
} from 'discord-api-types/v10';
import { DiscordApiError, type Rest } from './rest.js';
import { toMessagePayload, type MessageData } from './message.js';

/** What we hand back to Discord as the HTTP response. */
export interface InteractionResponse {
  type: InteractionResponseType;
  data?: unknown;
}

export interface InteractionMember {
  id: string;
  user: APIUser;
  roles: string[];
  /** Effective permissions in the channel the interaction came from. */
  permissions: bigint;
  nick: string | null;
}

/**
 * The fields of a raw interaction payload this bot reads. Discord's own types
 * are a wide union over every interaction kind, which makes each accessor a
 * type-narrowing exercise; this is the flat shape they all share in practice.
 * Ping interactions are answered before one of these is ever built.
 */
export interface RawInteraction {
  id: string;
  application_id: string;
  type: InteractionType;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; type: number };
  locale: string;
  member?: { user: APIUser; roles: string[]; permissions: string; nick?: string | null };
  user?: APIUser;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    options?: APIApplicationCommandInteractionDataOption[];
    resolved?: APIInteractionDataResolved;
    components?: { components: { custom_id: string; value?: string }[] }[];
  };
}

/**
 * One incoming interaction, shaped like discord.js's so the command code that
 * was written against it ports over with few changes.
 *
 * The one real difference is *how the first answer travels*. With the gateway,
 * `reply()` is an API call. Over HTTP the first answer is the HTTP response to
 * Discord's request, so `reply()` here just settles `firstResponse`, which the
 * router awaits and returns. Everything after the first answer — `editReply`,
 * `followUp` — is an ordinary API call, exactly as before.
 */
export class Interaction {
  readonly options: Options;
  readonly fields: ModalFields;

  /** Settles with whatever the handler answered first. */
  readonly firstResponse: Promise<InteractionResponse>;
  #settle!: (response: InteractionResponse) => void;

  responded = false;

  constructor(
    readonly raw: RawInteraction,
    private readonly rest: Rest,
  ) {
    this.options = new Options(raw.data?.options, raw.data?.resolved);
    this.fields = new ModalFields(raw.data?.components);
    this.firstResponse = new Promise((resolve) => (this.#settle = resolve));
  }

  // ── Identity ──────────────────────────────────────────────────────────────
  get id(): string {
    return this.raw.id;
  }
  get applicationId(): string {
    return this.raw.application_id;
  }
  get guildId(): string | null {
    return this.raw.guild_id ?? null;
  }
  get channelId(): string | null {
    return this.raw.channel?.id ?? this.raw.channel_id ?? null;
  }
  /** Numeric channel type of where this happened; 10-12 are threads. */
  get channelType(): number | null {
    return this.raw.channel?.type ?? null;
  }
  /** The invoking user's own Discord language, e.g. `es-419`. */
  get locale(): string {
    return this.raw.locale;
  }
  get user(): APIUser {
    return (this.raw.member?.user ?? this.raw.user)!;
  }
  get member(): InteractionMember | null {
    const member = this.raw.member;
    if (!member) return null;
    return {
      id: member.user.id,
      user: member.user,
      roles: member.roles,
      permissions: BigInt(member.permissions),
      nick: member.nick ?? null,
    };
  }

  // ── What kind of interaction ──────────────────────────────────────────────
  get isCommand(): boolean {
    return this.raw.type === InteractionType.ApplicationCommand;
  }
  get isAutocomplete(): boolean {
    return this.raw.type === InteractionType.ApplicationCommandAutocomplete;
  }
  get isComponent(): boolean {
    return this.raw.type === InteractionType.MessageComponent;
  }
  get isModalSubmit(): boolean {
    return this.raw.type === InteractionType.ModalSubmit;
  }
  get commandName(): string {
    return this.raw.data?.name ?? '';
  }
  get customId(): string {
    return this.raw.data?.custom_id ?? '';
  }
  /** 2 = button, 3 = string select. */
  get componentType(): number | null {
    return this.raw.data?.component_type ?? null;
  }
  /** Chosen values of a select menu. */
  get values(): string[] {
    return this.raw.data?.values ?? [];
  }

  // ── First response (the HTTP reply) ───────────────────────────────────────
  #answer(response: InteractionResponse): void {
    if (this.responded) throw new Error('This interaction was already acknowledged');
    this.responded = true;
    this.#settle(response);
  }

  async reply(data: MessageData | string): Promise<void> {
    this.#answer({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: toMessagePayload(data),
    });
  }

  /** Acknowledge now, answer later with `editReply`. Buys 15 minutes. */
  async deferReply(options: { flags?: number } = {}): Promise<void> {
    this.#answer({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: options.flags ?? 0 },
    });
  }

  /** Edit the message a component sits on, as the answer. */
  async update(data: MessageData | string): Promise<void> {
    this.#answer({ type: InteractionResponseType.UpdateMessage, data: toMessagePayload(data) });
  }

  async deferUpdate(): Promise<void> {
    this.#answer({ type: InteractionResponseType.DeferredMessageUpdate });
  }

  /** Must be the first answer: a modal cannot be deferred into. */
  async showModal(modal: { toJSON(): unknown }): Promise<void> {
    this.#answer({ type: InteractionResponseType.Modal, data: modal.toJSON() });
  }

  async respond(choices: { name: string; value: string }[]): Promise<void> {
    this.#answer({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices } });
  }

  // ── After the first response (ordinary API calls) ─────────────────────────
  async editReply(data: MessageData | string): Promise<void> {
    if (!this.responded) throw new Error('editReply needs reply() or deferReply() first');
    await this.#afterAck(() =>
      this.rest.editOriginalResponse(this.applicationId, this.raw.token, toMessagePayload(data)),
    );
  }

  async followUp(data: MessageData | string): Promise<void> {
    if (!this.responded) throw new Error('followUp needs reply() or deferReply() first');
    await this.#afterAck(() =>
      this.rest.createFollowup(this.applicationId, this.raw.token, toMessagePayload(data)),
    );
  }

  /**
   * The interaction token only becomes valid once Discord has *received* our
   * first answer, and we start the follow-up the instant we hand that answer
   * back. Usually the answer wins the race; sometimes it does not, and Discord
   * says 404 Unknown Webhook. That is never a real failure this early, so wait
   * a moment and try again.
   */
  async #afterAck<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof DiscordApiError) || error.status !== 404 || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
}

/** Reads a slash command's options, flattening the subcommand nesting. */
export class Options {
  /** The subcommand name, or null for a command that has none. */
  readonly subcommand: string | null = null;
  private readonly values = new Map<string, APIApplicationCommandInteractionDataOption>();

  constructor(
    options: readonly APIApplicationCommandInteractionDataOption[] | undefined,
    private readonly resolved: APIInteractionDataResolved | undefined,
  ) {
    const walk = (list: readonly APIApplicationCommandInteractionDataOption[] | undefined) => {
      for (const option of list ?? []) {
        if (
          option.type === ApplicationCommandOptionType.Subcommand ||
          option.type === ApplicationCommandOptionType.SubcommandGroup
        ) {
          (this as { subcommand: string | null }).subcommand = option.name;
          walk(option.options);
        } else {
          this.values.set(option.name, option);
        }
      }
    };
    walk(options);
  }

  private raw(name: string): unknown {
    return (this.values.get(name) as { value?: unknown } | undefined)?.value;
  }

  getString(name: string, required: true): string;
  getString(name: string): string | null;
  getString(name: string, required?: boolean): string | null {
    const value = this.raw(name);
    if (typeof value === 'string') return value;
    if (required) throw new Error(`Missing required option "${name}"`);
    return null;
  }

  getBoolean(name: string): boolean | null {
    const value = this.raw(name);
    return typeof value === 'boolean' ? value : null;
  }

  /** The id of a channel option. Resolved data is not needed for what we do with it. */
  getChannelId(name: string): string | null {
    const value = this.raw(name);
    return typeof value === 'string' ? value : null;
  }

  getRole(name: string, required: true): APIRole;
  getRole(name: string): APIRole | null;
  getRole(name: string, required?: boolean): APIRole | null {
    const id = this.raw(name);
    const role = typeof id === 'string' ? this.resolved?.roles?.[id] : undefined;
    if (role) return role;
    if (required) throw new Error(`Missing required option "${name}"`);
    return null;
  }

  getAttachment(name: string): APIAttachment | null {
    const id = this.raw(name);
    return (typeof id === 'string' ? this.resolved?.attachments?.[id] : undefined) ?? null;
  }

  /** What the user has typed so far into the option being autocompleted. */
  getFocused(): string {
    for (const option of this.values.values()) {
      if ('focused' in option && option.focused) return String((option as { value: unknown }).value ?? '');
    }
    return '';
  }
}

/** The text a user typed into each field of a submitted modal. */
export class ModalFields {
  private readonly values = new Map<string, string>();

  constructor(rows: { components: { custom_id: string; value?: string }[] }[] | undefined) {
    for (const row of rows ?? []) {
      for (const component of row.components) this.values.set(component.custom_id, component.value ?? '');
    }
  }

  /** Empty string for a field the user left blank, like discord.js. */
  getText(id: string): string {
    return this.values.get(id) ?? '';
  }
}
