/**
 * Persists the GitHub PAT, encrypted with the session's derived key, in
 * sessionStorage. Per WORKSTREAM_A_NOTES.md, workstream A's
 * `usePersistedSettings` deliberately does NOT handle the PAT — the brief
 * requires it be encrypted with the same session-passphrase-derived key
 * used for the data file, so that's on this (workstream C) module,
 * consuming `src/crypto` directly (`encryptWithKey`/`decryptWithKey`) as
 * A's notes instruct.
 *
 * The PAT never touches disk unencrypted, is never logged, and never
 * leaves the device except as an Authorization header to api.github.com
 * (via workstream A's github client) — per the brief's confirmed
 * architecture decisions.
 */

import { useCallback, useEffect, useState } from "react";
import { decryptWithKey, encryptWithKey } from "../crypto";
import type { EncryptedPayload } from "../types";

const STORAGE_KEY = "readstack:pat:encrypted";

export interface UsePersistedPatOptions {
  /** Derived session key from useSessionKey(). Encryption/decryption is a
   * no-op (returns null / never persists) until this is available. */
  sessionKey: CryptoKey | null;
  salt: Uint8Array | null;
  iterations: number;
}

export interface UsePersistedPatResult {
  /** The decrypted PAT, once loaded — null until decrypted or if none is
   * stored yet. */
  pat: string | null;
  /** True while the initial decrypt-on-mount attempt is in flight. */
  isLoading: boolean;
  /** Encrypts and persists a new PAT value. Requires sessionKey to be set
   * (throws otherwise — callers should gate the Settings UI's PAT field on
   * having unlocked first). */
  setPat: (value: string) => Promise<void>;
  /** Clears the stored PAT (e.g. on logout/lock). */
  clearPat: () => void;
}

export function usePersistedPat(options: UsePersistedPatOptions): UsePersistedPatResult {
  const { sessionKey, salt, iterations } = options;
  const [pat, setPatState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!sessionKey) return;
    const key = sessionKey;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const payload = JSON.parse(raw) as EncryptedPayload;
        const decrypted = await decryptWithKey<string>(payload, key);
        if (!cancelled) setPatState(decrypted);
      } catch {
        // Wrong/rotated key, corrupted payload, or nothing stored yet —
        // treat all the same as "no PAT available", forcing re-entry via
        // the Settings UI rather than surfacing a decrypt error for what
        // is effectively just "not configured".
        if (!cancelled) setPatState(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  const setPat = useCallback(
    async (value: string) => {
      if (!sessionKey || !salt) {
        throw new Error("Cannot store PAT before the session is unlocked.");
      }
      const payload = await encryptWithKey(value, sessionKey, salt, iterations);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setPatState(value);
    },
    [sessionKey, salt, iterations],
  );

  const clearPat = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setPatState(null);
  }, []);

  return { pat, isLoading, setPat, clearPat };
}
