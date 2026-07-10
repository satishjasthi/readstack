/**
 * Settings screen: GitHub PAT entry, passphrase entry, reading-speed (wpm)
 * config. Per the brief's delegation plan, this is workstream C's screen.
 *
 * Persistence split (per WORKSTREAM_A_NOTES.md, since A deliberately left
 * PAT storage to C):
 *   - readingSpeedWpm (+ githubOwner/repo/path/branch) -> workstream A's
 *     `usePersistedSettings` (plain sessionStorage) AND, once a store is
 *     loaded, `useDataStore().dispatch({ type: "UPDATE_SETTINGS", ... })`
 *     so the change is synced to the encrypted data file too.
 *   - GitHub PAT -> this module's own `usePersistedPat`, encrypted with the
 *     session key via `src/crypto` directly, per A's notes.
 *   - Passphrase itself is not "persisted" anywhere (per the brief, it must
 *     never touch disk) — `PassphraseField` just hands it to
 *     `useSessionKey().unlockFresh/unlockWithSalt`, done here so this
 *     screen is a complete, self-contained "settings" experience.
 *
 * This component does not render any Time Machine UI (workstream B's
 * scope) — it's a standalone screen/panel the app shell mounts separately.
 */

import { useCallback, useState } from "react";
import { PatField } from "./PatField";
import { PassphraseField } from "./PassphraseField";
import { ReadingSpeedField } from "./ReadingSpeedField";
import { usePersistedPat } from "./usePersistedPat";
import { useDataStore, usePersistedSettings, useSessionKey } from "../hooks";
import type { DataAction } from "../data";

export interface SettingsScreenProps {
  /** Whether an EncryptedPayload for existing data has already been seen
   * (i.e. this is a returning user unlocking, vs first-time setup). When
   * true, `salt`/`iterations` must be supplied (typically from the last
   * pulled EncryptedPayload) so `unlockWithSalt` re-derives the same key. */
  isReturningUser: boolean;
  existingSalt?: Uint8Array;
  existingIterations?: number;
}

/** Reads useDataStore() but tolerates being rendered outside a
 * <DataStoreProvider> (the brief's flow renders Settings before the user
 * has unlocked/configured GitHub, i.e. before a provider can exist) by
 * degrading to a null dispatch rather than throwing. Kept as its own hook
 * so the try/catch around a hook call lives in one obviously-intentional
 * place instead of being inlined into the component body. */
function useOptionalDispatch(): ((action: DataAction) => Promise<void>) | null {
  try {
    return useDataStore().dispatch;
  } catch {
    return null;
  }
}

export function SettingsScreen({
  isReturningUser,
  existingSalt,
  existingIterations,
}: SettingsScreenProps) {
  const sessionKeyState = useSessionKey();
  const { settings, updateSettings } = usePersistedSettings();
  const { pat, isLoading: patLoading, setPat } = usePersistedPat({
    sessionKey: sessionKeyState.key,
    salt: sessionKeyState.salt,
    iterations: sessionKeyState.iterations,
  });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const dispatch = useOptionalDispatch();

  const handlePassphraseSubmit = useCallback(
    async (passphrase: string) => {
      setUnlockError(null);
      try {
        if (isReturningUser && existingSalt) {
          await sessionKeyState.unlockWithSalt(passphrase, existingSalt, existingIterations);
        } else {
          await sessionKeyState.unlockFresh(passphrase);
        }
      } catch (err) {
        setUnlockError(err instanceof Error ? err.message : String(err));
      }
    },
    [sessionKeyState, isReturningUser, existingSalt, existingIterations],
  );

  const handleReadingSpeedChange = useCallback(
    (wpm: number) => {
      updateSettings({ readingSpeedWpm: wpm });
      if (dispatch) {
        void dispatch({ type: "UPDATE_SETTINGS", patch: { readingSpeedWpm: wpm } });
      }
    },
    [updateSettings, dispatch],
  );

  return (
    <section className="settings-screen" data-testid="settings-screen" aria-label="Settings">
      <h2>Settings</h2>

      <PassphraseField
        mode={isReturningUser ? "unlock" : "fresh"}
        onSubmit={handlePassphraseSubmit}
        error={unlockError}
      />

      <PatField
        hasStoredValue={pat !== null}
        onSave={setPat}
        disabled={!sessionKeyState.isUnlocked || patLoading}
      />

      <ReadingSpeedField
        valueWpm={settings.readingSpeedWpm}
        onChange={handleReadingSpeedChange}
      />
    </section>
  );
}
