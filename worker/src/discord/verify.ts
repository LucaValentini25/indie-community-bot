/**
 * Discord signs every interaction with Ed25519. Rejecting a bad signature with
 * a 401 is not optional — Discord probes the endpoint with a deliberately
 * invalid one when you save the URL, and refuses to save it if we answer 200.
 */

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('not hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// Workers has shipped Ed25519 under two names: the standard one, and the
// older `NODE-ED25519`. Try the standard first and remember what worked.
const ALGORITHMS = ['Ed25519', 'NODE-ED25519'] as const;
let working: (typeof ALGORITHMS)[number] | undefined;
const keys = new Map<string, CryptoKey>();

function algorithmFor(name: (typeof ALGORITHMS)[number]): SubtleCryptoImportKeyAlgorithm {
  return (name === 'Ed25519'
    ? { name }
    : { name, namedCurve: 'NODE-ED25519' }) as unknown as SubtleCryptoImportKeyAlgorithm;
}

async function importKey(publicKeyHex: string): Promise<{ key: CryptoKey; algorithm: string }> {
  const raw = hexToBytes(publicKeyHex);

  for (const name of working ? [working] : ALGORITHMS) {
    const cacheKey = `${name}:${publicKeyHex}`;
    const cached = keys.get(cacheKey);
    if (cached) return { key: cached, algorithm: name };

    try {
      const key = await crypto.subtle.importKey('raw', raw, algorithmFor(name), false, ['verify']);
      working = name;
      keys.set(cacheKey, key);
      return { key, algorithm: name };
    } catch {
      // Try the next name.
    }
  }

  throw new Error('This runtime cannot verify Ed25519 signatures');
}

/**
 * What is wrong with a configured public key, without ever revealing it. A
 * Discord public key is 32 bytes, so exactly 64 hex characters; anything else
 * (an Application ID, a client secret, stray whitespace from a paste) can
 * never verify a signature and is worth naming in the log.
 */
export function describePublicKey(publicKeyHex: string): { length: number; isHex: boolean; valid: boolean } {
  const key = publicKeyHex.trim();
  const isHex = /^[0-9a-f]*$/i.test(key);
  return { length: publicKeyHex.length, isHex, valid: isHex && key.length === 64 };
}

/** True only when `signature` is a valid signature of `timestamp + body`. */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string,
): Promise<boolean> {
  if (!signatureHex || !timestamp) return false;

  try {
    const { key, algorithm } = await importKey(publicKeyHex.trim());
    return await crypto.subtle.verify(
      algorithm,
      key,
      hexToBytes(signatureHex),
      encoder.encode(timestamp + body),
    );
  } catch {
    // Malformed hex, wrong key length, unsupported runtime: all mean "no".
    return false;
  }
}
