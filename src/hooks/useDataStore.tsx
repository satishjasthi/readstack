/**
 * The store workstreams B and C consume. Exposes ReadStackData state plus a
 * `dispatch` that applies a DataAction, persists it (encrypt + push to
 * GitHub, commit message = article name), and reflects sync status.
 *
 * Usage: wrap the app in <DataStoreProvider> (needs a GitHub token + a
 * derived CryptoKey/salt from useSessionKey — see App.tsx for wiring), then
 * call useDataStore() from any component/hook in B or C.
 *
 * Concurrency: `dispatch` calls are serialized through an internal queue
 * (`queueRef`) rather than firing independent concurrent pushes. Without
 * this, two dispatches issued close together (e.g. adding an article, then
 * immediately opening it — which itself dispatches START_SESSION and a
 * SET_WORD_COUNT once the word count resolves) would each read the same
 * `syncMeta.lastKnownSha` and race to push, and whichever POST reaches
 * GitHub second would be rejected with 409 (stale sha) — this is exactly
 * the failure mode reported against the real app. Serializing means the
 * second dispatch always builds on the sha the first dispatch's push
 * actually produced — `syncData()` updates the ref synchronously (not via
 * a render-driven assignment) so this holds regardless of React's render
 * timing. On top of that, each push additionally retries once on a 409 by
 * re-pulling the latest remote state and re-applying the action on top of
 * it, in case some *other* writer (another tab/device) changed the file in
 * between — a belt-and-suspenders on top of the in-process queue, which
 * only protects against races within this tab.
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
import { GitHubApiError } from "../github";
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
  /** Applies a local mutation, then encrypts + pushes it. Queued: if called
   * again before a previous dispatch's push has completed, it waits for
   * its turn rather than racing. Resolves once its push completes (or
   * throws after exhausting retries, leaving local state already updated —
   * the caller/UI can surface syncError and let the user retry). */
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

/** True if pushing hit a stale-sha conflict — worth one retry against fresh
 * state rather than surfacing immediately, since another dispatch (this tab
 * or another device) may have simply won the race. */
function isStaleShaConflict(err: unknown): boolean {
  return err instanceof GitHubApiError && (err.status === 409 || err.status === 422);
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

  // Source of truth for the *current* document as far as dispatch/runOne
  // is concerned. Deliberately NOT synced from `data` via a render-time
  // assignment (`dataRef.current = data` during render) — that approach is
  // subtly broken for a serialized queue: `setData` schedules a re-render,
  // but the queue's next `runOne` can start executing as a microtask
  // *before* React has actually re-rendered and re-run that assignment, so
  // it would read a stale document despite the queue having already
  // "waited its turn". Instead, `runOne` updates this ref synchronously
  // itself (`syncData`) at the same time it calls `setData`, so the ref is
  // always current for whichever dispatch reads it next, independent of
  // React's render timing. `load()` also goes through `syncData`.
  const dataRef = useRef<ReadStackData | null>(null);

  const syncData = useCallback((next: ReadStackData | null) => {
    dataRef.current = next;
    setData(next);
  }, []);

  // Serializes dispatch calls: each call chains onto the previous one's
  // promise so pushes never race against each other from this tab. See the
  // module doc comment above for why this matters.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const syncCfg = useMemo(
    () => ({ github, key: sessionKey, salt, iterations }),
    [github, sessionKey, salt, iterations],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setSyncError(null);
    try {
      const result = await pull(syncCfg, defaultSettings);
      // `result.sha` (the actual git blob sha GitHub just returned) is
      // authoritative; whatever `lastKnownSha` happens to be embedded
      // inside the decrypted document itself is just a past writer's
      // best-effort echo and must not be trusted over this.
      syncData({
        ...result.data,
        syncMeta: { ...result.data.syncMeta, lastKnownSha: result.sha },
      });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [syncCfg, defaultSettings, syncData]);

  /** The actual push-with-one-retry-on-conflict logic for a single action,
   * run once this dispatch has reached the front of the queue. */
  const runOne = useCallback(
    async (action: DataAction) => {
      let current = dataRef.current;
      if (!current) {
        throw new Error("Cannot dispatch before data is loaded — call load() first.");
      }

      const commitMessage = commitMessageFor(current, action);
      let next = dataReducer(current, action);
      syncData(next);

      if (!commitMessage) {
        // Bookkeeping-only action (e.g. SET_SHA/SET_SYNCED_AT applied
        // internally) — no push needed.
        return;
      }

      setSyncStatus("syncing");
      setSyncError(null);

      const attemptPush = (doc: ReadStackData) =>
        push(syncCfg, doc, commitMessage, doc.syncMeta.lastKnownSha);

      try {
        let result;
        try {
          result = await attemptPush(next);
        } catch (err) {
          if (!isStaleShaConflict(err)) throw err;
          // Someone else (another tab/device) moved the file since our
          // last pull. Re-pull the ACTUAL current git blob sha (`pull`'s
          // own `sha` return value — not whatever `syncMeta.lastKnownSha`
          // happened to be embedded in that writer's encrypted payload,
          // which is only ever a best-effort echo of a sha some past
          // writer had and is not authoritative) so the retry's push
          // uses a value GitHub will actually accept, re-apply this
          // dispatch's action on top of the fresh document, and push
          // once more. This is a single retry, not a loop — a second
          // consecutive conflict is surfaced to the user rather than
          // retried indefinitely.
          const latest = await pull(syncCfg, defaultSettings);
          current = { ...latest.data, syncMeta: { ...latest.data.syncMeta, lastKnownSha: latest.sha } };
          next = dataReducer(current, action);
          syncData(next);
          result = await attemptPush(next);
        }

        syncData({ ...next, syncMeta: { lastKnownSha: result.sha, lastSyncedAt: Date.now() } });
        setSyncStatus("idle");
      } catch (err) {
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [syncCfg, defaultSettings, syncData],
  );

  const dispatch = useCallback(
    (action: DataAction) => {
      // Chain onto the queue regardless of whether the previous entry
      // succeeded or failed, so one failed dispatch doesn't wedge the
      // queue for everything after it — but still propagate this
      // dispatch's own outcome to its caller.
      const previous = queueRef.current;
      const result = previous.catch(() => undefined).then(() => runOne(action));
      queueRef.current = result.catch(() => undefined);
      return result;
    },
    [runOne],
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
