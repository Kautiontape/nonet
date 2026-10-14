/**
 * The sync code: the one secret a player carries between their devices. Sixteen Crockford
 * base32 characters (80 bits), shown in four groups. The server never sees it: the cloud file
 * is named by its hash, so knowing the code is the whole authorisation.
 */

/** Crockford's alphabet: no I, L, O or U, so a code read off a screen can't be misread. */
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 16;

type Random = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

/** A fresh code. `random` fills bytes; the default wraps the platform's generator (it must be called as a method). */
export function generateCode(random: Random = (a) => crypto.getRandomValues(a)): string {
  const bytes = random(new Uint8Array(CODE_LENGTH));
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i]! & 31];
  return code;
}

/**
 * What a player typed, as a code: any case, dashes and spaces optional, I and L read as 1 and O
 * as 0. Null unless it comes out as a whole code.
 */
export function normalizeCode(text: string): string | null {
  const s = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}

/** `ABCD-EFGH-JKMN-PQRS`: four groups, as shown and read aloud. */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** The cloud file's name: a hash of the code under a fixed prefix, as 64 hex characters. */
export async function bucketId(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nonet-sync:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
