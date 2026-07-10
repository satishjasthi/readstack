/**
 * Tracks accumulated "active" time in the ReadStack tab itself — this is the
 * proxy signal for "how long the externally-opened article was probably
 * being read" (see completionFormula.ts's docblock for why this is only a
 * proxy, never a direct measurement of the external page).
 *
 * A session is "active" while:
 *   - `document.visibilityState === "visible"`, AND
 *   - the window has focus (not blurred to another app/window).
 *
 * Time is accumulated in discrete deltas between state transitions, so a
 * long-running session doesn't need a polling interval to stay accurate —
 * only visibilitychange/focus/blur events plus reads of `Date.now()` at
 * transition points and whenever the caller asks for the current total via
 * `getActiveMs()`.
 */

export interface VisibilityTrackerHandle {
  /** Total accumulated active ms so far, including the current open span if
   * the tab is currently active. */
  getActiveMs: () => number;
  /** Stops listening and returns the final accumulated active ms. Safe to
   * call multiple times (idempotent after the first call). */
  stop: () => number;
}

/**
 * Starts tracking active time from "now". Call once per reading session
 * (i.e. once per "open in new tab" click) and `stop()` it when the session
 * ends (article removed, app closed, or periodically to snapshot progress —
 * callers can keep calling `getActiveMs()` without stopping to sample
 * mid-session).
 */
export function startVisibilityTracking(
  target: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  now: () => number = Date.now,
): VisibilityTrackerHandle {
  let accumulatedMs = 0;
  let activeSpanStartedAt: number | null = isActiveNow() ? now() : null;
  let stopped = false;

  function isActiveNow(): boolean {
    return target.visibilityState === "visible";
  }

  function closeActiveSpanIfOpen(): void {
    if (activeSpanStartedAt !== null) {
      accumulatedMs += Math.max(0, now() - activeSpanStartedAt);
      activeSpanStartedAt = null;
    }
  }

  function openActiveSpanIfClosed(): void {
    if (activeSpanStartedAt === null && isActiveNow()) {
      activeSpanStartedAt = now();
    }
  }

  function handleVisibilityChange(): void {
    if (target.visibilityState === "visible") {
      openActiveSpanIfClosed();
    } else {
      closeActiveSpanIfOpen();
    }
  }

  function handleBlur(): void {
    closeActiveSpanIfOpen();
  }

  function handleFocus(): void {
    openActiveSpanIfClosed();
  }

  target.addEventListener("visibilitychange", handleVisibilityChange);
  windowTarget.addEventListener("blur", handleBlur);
  windowTarget.addEventListener("focus", handleFocus);

  function getActiveMs(): number {
    if (activeSpanStartedAt !== null) {
      return accumulatedMs + Math.max(0, now() - activeSpanStartedAt);
    }
    return accumulatedMs;
  }

  function stop(): number {
    if (!stopped) {
      closeActiveSpanIfOpen();
      target.removeEventListener("visibilitychange", handleVisibilityChange);
      windowTarget.removeEventListener("blur", handleBlur);
      windowTarget.removeEventListener("focus", handleFocus);
      stopped = true;
    }
    return accumulatedMs;
  }

  return { getActiveMs, stop };
}
