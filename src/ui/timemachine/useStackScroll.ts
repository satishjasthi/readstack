/**
 * Wheel + touch-swipe navigation through the stack. Attaches native
 * listeners to a container ref (non-passive wheel so we can preventDefault
 * and stop page scroll from fighting the stack), and exposes the current
 * focus index plus setters. Pure interaction glue — the actual per-slice
 * geometry lives in stackMath.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clampFocusIndex, deltaToStep } from "./stackMath";

export interface UseStackScrollOptions {
  length: number;
  initialIndex?: number;
  /** min px delta (wheel) / swipe distance (touch) before advancing one slice. */
  threshold?: number;
}

export interface UseStackScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  focusIndex: number;
  setFocusIndex: (index: number) => void;
  stepBy: (delta: -1 | 1) => void;
}

export function useStackScroll({
  length,
  initialIndex = 0,
  threshold = 24,
}: UseStackScrollOptions): UseStackScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusIndex, setFocusIndexRaw] = useState(() => clampFocusIndex(initialIndex, length));
  const touchStartY = useRef<number | null>(null);
  const wheelAccumulator = useRef(0);
  const wheelCooldown = useRef(false);

  // Re-clamp if the underlying list length changes (e.g. article added/removed).
  useEffect(() => {
    setFocusIndexRaw((prev) => clampFocusIndex(prev, length));
  }, [length]);

  const setFocusIndex = useCallback(
    (index: number) => {
      setFocusIndexRaw(clampFocusIndex(index, length));
    },
    [length],
  );

  const stepBy = useCallback(
    (delta: -1 | 1) => {
      setFocusIndexRaw((prev) => clampFocusIndex(prev + delta, length));
    },
    [length],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Debounce rapid wheel events into single-slice steps rather than
      // free-scrolling — mirrors Time Machine's "tick per gesture" feel.
      if (wheelCooldown.current) return;
      wheelAccumulator.current += e.deltaY;
      const step = deltaToStep(wheelAccumulator.current, threshold);
      if (step !== 0) {
        setFocusIndexRaw((prev) => clampFocusIndex(prev + step, length));
        wheelAccumulator.current = 0;
        wheelCooldown.current = true;
        window.setTimeout(() => {
          wheelCooldown.current = false;
        }, 220);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0]?.clientY ?? null;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartY.current === null) return;
      const endY = e.changedTouches[0]?.clientY ?? touchStartY.current;
      const delta = touchStartY.current - endY; // swipe up = positive = advance forward
      const step = deltaToStep(delta, threshold);
      if (step !== 0) {
        setFocusIndexRaw((prev) => clampFocusIndex(prev + step, length));
      }
      touchStartY.current = null;
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [length, threshold]);

  return { containerRef, focusIndex, setFocusIndex, stepBy };
}
