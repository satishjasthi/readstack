/**
 * PBKDF2 key derivation from a user passphrase, via WebCrypto.
 *
 * The derived key never leaves memory (or sessionStorage as a wrapped/opaque
 * value handled by the caller) and is re-derived each session from the
 * passphrase — never persisted to disk in raw form.
 */

const DEFAULT_ITERATIONS = 250_000;
const SALT_BYTES = 16;

/** Generates a new random salt for a first-time setup (new data file). */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** Derives an AES-GCM CryptoKey from a passphrase and salt using PBKDF2-SHA256. */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export { DEFAULT_ITERATIONS };
