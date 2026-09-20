import type { APIUser } from 'discord-api-types/v10';

/**
 * A user's avatar URL, or their default one.
 *
 * discord.js does this in `displayAvatarURL()`; over raw payloads we only have
 * the hash, so it is rebuilt here.
 */
export function avatarUrl(user: Pick<APIUser, 'id' | 'avatar' | 'discriminator'>, size = 64): string {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
  }
  // Default avatars are picked from the snowflake for pomelo (no discriminator) accounts.
  const index =
    user.discriminator === '0' ? Number((BigInt(user.id) >> 22n) % 6n) : Number(user.discriminator) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * One unicode emoji, in any of the shapes Discord accepts on a button: a flag
 * (two regional indicators), a keycap (`1️⃣`), or a pictograph with optional
 * variation selector / skin tone, joined with ZWJ into sequences (`👨‍👩‍👧`).
 * Written as alternatives rather than a character class, because the combining
 * marks would make a class ambiguous.
 */
const PICTOGRAPH = '\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?';
const UNICODE_EMOJI = new RegExp(
  `^(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|${PICTOGRAPH}(?:\\u200D${PICTOGRAPH})*)$`,
  'u',
);

/**
 * Turns the text of an emoji option into what a button's `emoji` field wants:
 * `{ name }` for a unicode emoji, `{ name, id, animated }` for a custom one.
 * Returns null for anything else, which is how `/selfrole add` rejects a typo
 * up front instead of failing when the panel is posted.
 */
export function parseEmoji(text: string): { name: string; id?: string; animated?: boolean } | null {
  const custom = /^<(a)?:(\w{2,32}):(\d{17,20})>$/.exec(text);
  if (custom) return { name: custom[2]!, id: custom[3]!, animated: custom[1] === 'a' };

  return UNICODE_EMOJI.test(text) ? { name: text } : null;
}
