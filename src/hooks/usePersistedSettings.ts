/**
 * Persists non-secret settings (GitHub owner/repo/path/branch, reading
 * speed) in sessionStorage as plain JSON — these aren't sensitive. The PAT
 * itself is NOT handled here: per the brief it must be encrypted with the
 * session key, which workstream C's Settings UI (src/settings/**) is
 * responsible for wiring up via the crypto module directly. This hook only
 * covers the plain settings fields workstream A needs for the sync engine
 * config (owner/repo/path/branch/readingSpeedWpm).
 *
 * `readstack-data` is a PUBLIC repo — the JSON file itself is encrypted
 * client-side (AES-GCM), so repo visibility isn't the security boundary.
 * This means reads (pull on load) work with no token at all; only writes
 * (push on mutation) need a PAT, since GitHub never allows anonymous pushes.
 */

import { useCallback, useState } from "react";
import type { UserSettings } from "../types";

const STORAGE_KEY = "readstack:settings";

export const DEFAULT_SETTINGS: UserSettings = {
  readingSpeedWpm: 200,
  githubOwner: "",
  githubRepo: "readstack-data",
  dataFilePath: "data.json.enc",
  githubBranch: "main",
};

function readFromStorage(): UserSettings {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface UsePersistedSettingsResult {
  settings: UserSettings;
  updateSettings: (patch: Partial<UserSettings>) => void;
}

export function usePersistedSettings(): UsePersistedSettingsResult {
  const [settings, setSettings] = useState<UserSettings>(readFromStorage);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
