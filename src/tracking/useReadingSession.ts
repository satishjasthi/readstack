/**
 * Article-open tracking flow.
 *
 * When a Time Machine card/slice is clicked (workstream B calls
 * `openArticle`), this hook:
 *   1. Opens the article URL in a new tab.
 *   2. Records a new `ReadingSession` (openedAt = now) via
 *      `dispatch({ type: "START_SESSION", ... })` (workstream A's store).
 *   3. Starts a `visibilityTracker` to accumulate active time on the
 *      ReadStack tab as a proxy signal for "the external tab was probably
 *      being read" (see completionFormula.ts + visibilityTracker.ts for why
 *      this is a proxy, not a direct measurement).
 *   4. Periodically (every `recomputeIntervalMs`, default 15s) AND whenever
 *      the ReadStack tab regains focus/visibility ("return-to-app"),
 *      recomputes completion via `computeCompletion` and persists both the
 *      session's `activeMs` (`UPDATE_SESSION`) and the article's derived
 *      `completion`/`status` (`APPLY_COMPLETION`) through
 *      `useDataStore().dispatch`.
 *
 * This hook does NOT own the store — it only calls `dispatch` with actions
 * workstream A's reducer already understands. It does not touch any UI
 * (workstream B's job); callers wire `openArticle` to a click handler
 * themselves.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { computeCompletion } from "./completionFormula";
import { startVisibilityTracking, type VisibilityTrackerHandle } from "./visibilityTracker";
import { estimateWordCount } from "./wordCountEstimate";
import { useDataStore } from "../hooks";
import { expectedReadingMs, generateId } from "../utils";
import type { Article, ReadingSession } from "../types";

const DEFAULT_RECOMPUTE_INTERVAL_MS = 15_000;

export interface UseReadingSessionOptions {
  /** How often (ms) to recompute + persist completion while a session is
   * open, in addition to on return-to-app. Default 15s. */
  recomputeIntervalMs?: number;
  /** Reading speed in wpm, used to compute expectedMs. Typically sourced
   * from `data.settings.readingSpeedWpm`. */
  readingSpeedWpm: number;
  /** window/document-like targets, overridable for tests. */
  windowTarget?: Window;
  documentTarget?: Document;
}

export interface UseReadingSessionResult {
  /** Opens the article in a new tab and starts tracking a session for it.
   * Idempotent per article while a session is already open — calling again
   * before `closeSession` just no-ops on the tracker (a new tab still
   * opens, since the user explicitly clicked again). */
  openArticle: (article: Article) => void;
  /** Ends tracking for the given article's current session, doing one
   * final completion recompute + persist. Safe to call even if no session
   * is active for that article. */
  closeSession: (articleId: string) => Promise<void>;
  /** Self-reported scroll depth update for the active session (v1 has no
   * way to sample this from the external page — see brief). Recomputes and
   * persists completion immediately so the UI reflects the new estimate. */
  reportScrollDepth: (articleId: string, scrollDepth: number) => Promise<void>;
}

interface ActiveSession {
  session: ReadingSession;
  tracker: VisibilityTrackerHandle;
  intervalId: ReturnType<typeof setInterval>;
  scrollDepth: number;
}

export function useReadingSession(options: UseReadingSessionOptions): UseReadingSessionResult {
  const { dispatch, data } = useDataStore();
  const recomputeIntervalMs = options.recomputeIntervalMs ?? DEFAULT_RECOMPUTE_INTERVAL_MS;
  const windowTarget = options.windowTarget ?? window;
  const documentTarget = options.documentTarget ?? document;

  // articleId -> in-flight session bookkeeping. Ref, not state: this is
  // imperative tracking machinery, not render-driving data (the persisted
  // Article/ReadingSession in the store is what drives UI).
  const activeSessionsRef = useRef<Map<string, ActiveSession>>(new Map());

  const recompute = useCallback(
    async (articleId: string) => {
      const active = activeSessionsRef.current.get(articleId);
      if (!active) return;

      const article = data?.articles.find((a) => a.id === articleId);
      const readingSpeedWpm = options.readingSpeedWpm > 0 ? options.readingSpeedWpm : 200;
      const wordCount = article?.wordCount ?? 0;
      const expectedMs = expectedReadingMs(wordCount, readingSpeedWpm);

      const activeMs = active.tracker.getActiveMs();
      active.session = { ...active.session, activeMs, lastUpdatedAt: Date.now() };

      await dispatch({
        type: "UPDATE_SESSION",
        articleId,
        sessionId: active.session.id,
        patch: { activeMs, scrollDepth: active.scrollDepth, lastUpdatedAt: Date.now() },
      });

      const result = computeCompletion({
        scrollDepth: active.scrollDepth,
        activeMs,
        expectedMs,
      });

      await dispatch({ type: "APPLY_COMPLETION", articleId, result });
    },
    [data, dispatch, options.readingSpeedWpm],
  );

  const openArticle = useCallback(
    (article: Article) => {
      windowTarget.open(article.url, "_blank", "noopener,noreferrer");

      if (activeSessionsRef.current.has(article.id)) {
        // Session already being tracked for this article — don't start a
        // second tracker, just let the existing one keep accumulating.
        return;
      }

      const now = Date.now();
      const session: ReadingSession = {
        id: generateId(),
        articleId: article.id,
        openedAt: now,
        lastUpdatedAt: now,
        activeMs: 0,
        scrollDepth: 0,
        measurement: "estimated",
      };

      const tracker = startVisibilityTracking(documentTarget, windowTarget);
      const intervalId = setInterval(() => {
        void recompute(article.id);
      }, recomputeIntervalMs);

      activeSessionsRef.current.set(article.id, {
        session,
        tracker,
        intervalId,
        scrollDepth: 0,
      });

      void dispatch({ type: "START_SESSION", articleId: article.id, session });

      // Best-effort word count fetch if we don't already have one — needed
      // for expectedMs in the completion formula. Manual override (via
      // SET_WORD_COUNT from the settings/article-form UI) always takes
      // precedence over anything this resolves later, since callers can
      // dispatch SET_WORD_COUNT themselves; we only fill it in if unset.
      if (article.wordCount === undefined) {
        void estimateWordCount(article.url).then((result) => {
          if (!result.failed && result.wordCount !== undefined) {
            void dispatch({
              type: "SET_WORD_COUNT",
              articleId: article.id,
              wordCount: result.wordCount,
              isManual: false,
            });
          }
          // On failure we deliberately do nothing here — the brief's manual
          // entry field (settings/article-form UI) is the real fallback;
          // this hook has no UI to prompt through.
        });
      }
    },
    [dispatch, documentTarget, windowTarget, recomputeIntervalMs, recompute],
  );

  const closeSession = useCallback(
    async (articleId: string) => {
      const active = activeSessionsRef.current.get(articleId);
      if (!active) return;

      clearInterval(active.intervalId);
      active.tracker.stop();
      activeSessionsRef.current.delete(articleId);

      // One last recompute+persist using the final accumulated active time.
      // Re-insert a transient entry so `recompute` (which reads from the
      // map) has something to work with, since we already deleted above.
      activeSessionsRef.current.set(articleId, active);
      await recompute(articleId);
      activeSessionsRef.current.delete(articleId);
    },
    [recompute],
  );

  const reportScrollDepth = useCallback(
    async (articleId: string, scrollDepth: number) => {
      const active = activeSessionsRef.current.get(articleId);
      if (!active) return;
      active.scrollDepth = Math.max(0, Math.min(1, scrollDepth));
      await recompute(articleId);
    },
    [recompute],
  );

  // Return-to-app: recompute all active sessions whenever the ReadStack tab
  // regains focus/visibility, per the brief's "on return-to-app... recompute
  // completion" requirement.
  useEffect(() => {
    function handleReturnToApp() {
      if (documentTarget.visibilityState !== "visible") return;
      for (const articleId of activeSessionsRef.current.keys()) {
        void recompute(articleId);
      }
    }

    documentTarget.addEventListener("visibilitychange", handleReturnToApp);
    windowTarget.addEventListener("focus", handleReturnToApp);
    return () => {
      documentTarget.removeEventListener("visibilitychange", handleReturnToApp);
      windowTarget.removeEventListener("focus", handleReturnToApp);
    };
  }, [documentTarget, windowTarget, recompute]);

  // Cleanup all trackers/intervals on unmount so nothing leaks past the
  // component's lifetime.
  useEffect(() => {
    return () => {
      for (const active of activeSessionsRef.current.values()) {
        clearInterval(active.intervalId);
        active.tracker.stop();
      }
      activeSessionsRef.current.clear();
    };
  }, []);

  return useMemo(
    () => ({ openArticle, closeSession, reportScrollDepth }),
    [openArticle, closeSession, reportScrollDepth],
  );
}
