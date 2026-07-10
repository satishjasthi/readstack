/**
 * Manages the session's derived AES-GCM key. The key (and the raw
 * passphrase) live only in memory for the lifetime of the tab — per the
 * brief, never persisted to disk. `salt`/`iterations` are not secret and are
 * kept alongside so callers can re-derive without re-asking the user only
 * within the same in-memory session (e.g. React StrictMode double-invoke);
 * a full page reload always re-prompts for the passphrase.
 */

import { useCallback, useState } from "react";
import { DEFAULT_ITERATIONS, deriveKey, generateSalt } from "../crypto";

export interface SessionKeyState {
  key: CryptoKey | null;
  salt: Uint8Array | null;
  iterations: number;
  /** True once a key has been derived and is ready to use. */
  isUnlocked: boolean;
}

export interface UseSessionKeyResult extends SessionKeyState {
  /** Derives and stores a key from an existing salt (returning user, salt
   * came from the pulled EncryptedPayload). */
  unlockWithSalt: (passphrase: string, salt: Uint8Array, iterations?: number) => Promise<CryptoKey>;
  /** Generates a fresh salt and derives a key (first-time setup, no data
   * file exists yet). */
  unlockFresh: (passphrase: string) => Promise<CryptoKey>;
  /** Clears the key from memory (e.g. explicit lock / tab teardown). */
  lock: () => void;
}

export function useSessionKey(): UseSessionKeyResult {
  const [state, setState] = useState<SessionKeyState>({
    key: null,
    salt: null,
    iterations: DEFAULT_ITERATIONS,
    isUnlocked: false,
  });

  const unlockWithSalt = useCallback(
    async (passphrase: string, salt: Uint8Array, iterations: number = DEFAULT_ITERATIONS) => {
      const key = await deriveKey(passphrase, salt, iterations);
      setState({ key, salt, iterations, isUnlocked: true });
      return key;
    },
    [],
  );

  const unlockFresh = useCallback(async (passphrase: string) => {
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);
    setState({ key, salt, iterations: DEFAULT_ITERATIONS, isUnlocked: true });
    return key;
  }, []);

  const lock = useCallback(() => {
    setState({ key: null, salt: null, iterations: DEFAULT_ITERATIONS, isUnlocked: false });
  }, []);

  return { ...state, unlockWithSalt, unlockFresh, lock };
}
