/**
 * AES-GCM encrypt/decrypt via WebCrypto, plus base64 helpers for the wire
 * format (EncryptedPayload — see src/types/index.ts).
 */

import type { EncryptedPayload } from "../types";
import { DEFAULT_ITERATIONS, deriveKey, generateSalt } from "./pbkdf2";

const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypts an arbitrary JSON-serializable value into the wire format stored
 * in `data.json.enc`. Generates a fresh salt + IV each call (a fresh salt on
 * every encrypt is unnecessary if reusing an existing key, but keeping the
 * salt stable across saves lets us reuse a derived key across the session —
 * see `encryptWithKey` for that path).
 */
export async function encrypt(
  value: unknown,
  passphrase: string,
): Promise<EncryptedPayload> {
  const salt = generateSalt();
  const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);
  return encryptWithKey(value, key, salt, DEFAULT_ITERATIONS);
}

/** Encrypts using an already-derived key (avoids re-running PBKDF2 on every
 * save within a session). `salt`/`iterations` are carried through only so
 * they can be written into the payload for later decryption. */
export async function encryptWithKey(
  value: unknown,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    iterations,
  };
}

/**
 * Decrypts an EncryptedPayload with a user passphrase, re-deriving the key
 * from the salt/iterations embedded in the payload.
 *
 * Throws if the passphrase is wrong or the ciphertext has been tampered with
 * (AES-GCM auth tag failure surfaces as a WebCrypto `OperationError`).
 */
export async function decrypt<T = unknown>(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<T> {
  const salt = base64ToBytes(payload.salt);
  const key = await deriveKey(passphrase, salt, payload.iterations);
  return decryptWithKey<T>(payload, key);
}

/** Decrypts using an already-derived key. */
export async function decryptWithKey<T = unknown>(
  payload: EncryptedPayload,
  key: CryptoKey,
): Promise<T> {
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  const json = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(json) as T;
}
