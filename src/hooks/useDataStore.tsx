/**
 * The store workstreams B and C consume. Exposes ReadStackData state plus a
 * `dispatch` that applies a DataAction, persists it (encrypt + push to
 * GitHub, commit message = article name), and reflects sync status.
 *
 * Usage: wrap the app in <DataStoreProvider> (needs a GitHub token + a
 * derived CryptoKey/salt from useSessionKey — see App.tsx for wiring), then
 * call useDataStore() from any component/hook in B or C.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { commitMessageFor, dataReducer, pull, push, type DataAction } from "../data";
import type { GitHubFileClientConfig } from "../github";
import type { ReadStackData, UserSettings } from "../types";

export type SyncStatus = "idle" | "syncing" | "error";

export interface DataStoreContextValue {
  data: ReadStackData | null;
  /** True while the initial pull-and-decrypt is in flight. */
  isLoading: boolean;
  syncStatus: SyncStatus;
  /** Set when the last pull or push failed; cleared on the next successful
   * operation. */
  syncError: string | null;
  /** Pulls + decrypts from GitHub and hydrates state. Call once after
   * unlocking (key available) and GitHub config is known. */
  load: () => Promise<void>;
  /** Applies a local mutation, then encrypts + pushes it. Resolves once the
   * push completes (or throws, leaving local state already updated — the
   * caller/UI can surface syncError and let the user retry). */
  dispatch: (action: DataAction) => Promise<void>;
}

const DataStoreContext = createContext<DataStoreContextValue | null>(null);

export interface DataStoreProviderProps {
  children: ReactNode;
  github: GitHubFileClientConfig;
  /** Derived AES-GCM key for this session (from useSessionKey). */
  sessionKey: CryptoKey;
  salt: Uint8Array;
  iterations: number;
  defaultSettings: UserSettings;
}

export function DataStoreProvider({
  children,
  github,
  sessionKey,
  salt,
  iterations,
  defaultSettings,
}: DataStoreProviderProps) {
  const [data, setData] = useState<ReadStackData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);

  // Ref mirrors `data` so dispatch() always pushes off the latest value even
  // if multiple dispatches are in flight, without re-creating the callback.
  const dataRef = useRef<ReadStackData | null>(null);
  dataRef.current = data;

  const syncCfg = useMemo(
    () => ({ github, key: sessionKey, salt, iterations }),
    [github, sessionKey, salt, iterations],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setSyncError(null);
    try {
      const result = await pull(syncCfg, defaultSettings);
      setData(result.data);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [syncCfg, defaultSettings]);

  const dispatch = useCallback(
    async (action: DataAction) => {
      const current = dataRef.current;
      if (!current) {
        throw new Error("Cannot dispatch before data is loaded — call load() first.");
      }

      const commitMessage = commitMessageFor(current, action);
      const next = dataReducer(current, action);
      setData(next);

      if (!commitMessage) {
        // Bookkeeping-only action (e.g. SET_SHA/SET_SYNCED_AT applied
        // internally) — no push needed.
        return;
      }

      setSyncStatus("syncing");
      setSyncError(null);
      try {
        const result = await push(syncCfg, next, commitMessage, next.syncMeta.lastKnownSha);
        setData((prev) =>
          prev
            ? { ...prev, syncMeta: { lastKnownSha: result.sha, lastSyncedAt: Date.now() } }
            : prev,
        );
        setSyncStatus("idle");
      } catch (err) {
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [syncCfg],
  );

  const value: DataStoreContextValue = {
    data,
    isLoading,
    syncStatus,
    syncError,
    load,
    dispatch,
  };

  return <DataStoreContext.Provider value={value}>{children}</DataStoreContext.Provider>;
}

/** Consumed by workstreams B and C to read state and dispatch mutations. */
export function useDataStore(): DataStoreContextValue {
  const ctx = useContext(DataStoreContext);
  if (!ctx) {
    throw new Error("useDataStore() must be called within a <DataStoreProvider>.");
  }
  return ctx;
}
