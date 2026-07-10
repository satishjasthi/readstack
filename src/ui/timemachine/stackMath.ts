/**
 * Pure geometry helpers for the Time-Machine-style receding card stack.
 * No React, no DOM — easy to unit test and reused by StackCard + useStackScroll.
 *
 * Model: articles are ordered oldest-first (as stored). We render them as a
 * stack where `focusIndex` is the "front" card (closest to the viewer, at
 * full scale, zero depth offset). Cards before/after focusIndex recede into
 * the distance in both directions, similar to macOS Time Machine where you
 * scrub forward/back through a chronological stack.
 */

export interface SliceTransform {
  /** translateZ in px — negative pushes the card back into the scene. */
  translateZ: number;
  /** translateY in px — slight vertical drift as cards recede. */
  translateY: number;
  /** uniform scale, 0-1. */
  scale: number;
  /** 0-1 opacity, fades out cards far from focus. */
  opacity: number;
  /** stacking order; higher renders on top. */
  zIndex: number;
  /** whether the slice should be interactive/clickable at this depth. */
  isInteractive: boolean;
}

export interface StackMathOptions {
  /** px of translateZ recession per step away from focus. */
  depthStep?: number;
  /** scale reduction per step away from focus. */
  scaleStep?: number;
  /** px of vertical drift per step away from focus. */
  driftStep?: number;
  /** how many steps away from focus a card is still rendered (perf + visual). */
  maxVisibleSteps?: number;
}

const DEFAULTS: Required<StackMathOptions> = {
  depthStep: 90,
  scaleStep: 0.08,
  driftStep: 14,
  maxVisibleSteps: 6,
};

/** Computes the 3D transform for a single slice at `index`, given the
 * current `focusIndex`. Cards ahead of focus (index < focusIndex) recede
 * "into the past"; cards after (index > focusIndex) recede "into the
 * future" — both directions stack backward in Z so the focused card is
 * always frontmost, matching Time Machine's single-direction recession
 * (we recede both ways since the user can scrub either direction).
 */
export function computeSliceTransform(
  index: number,
  focusIndex: number,
  options: StackMathOptions = {},
): SliceTransform {
  const { depthStep, scaleStep, driftStep, maxVisibleSteps } = { ...DEFAULTS, ...options };
  const distance = Math.abs(index - focusIndex);
  const clampedDistance = Math.min(distance, maxVisibleSteps);

  const translateZ = -clampedDistance * depthStep;
  const scale = Math.max(0.1, 1 - clampedDistance * scaleStep);
  const translateY = clampedDistance * driftStep * (index > focusIndex ? 1 : -1) * 0.5;
  const opacity = distance > maxVisibleSteps ? 0 : Math.max(0, 1 - clampedDistance * 0.16);
  const zIndex = 1000 - clampedDistance;
  const isInteractive = distance <= maxVisibleSteps;

  return { translateZ, translateY, scale, opacity, zIndex, isInteractive };
}

/** CSS transform string for a given SliceTransform. */
export function transformToCss(t: SliceTransform): string {
  return `translateY(${t.translateY}px) translateZ(${t.translateZ}px) scale(${t.scale})`;
}

/** Clamps a focus index into the valid [0, length-1] range (or -1 if empty). */
export function clampFocusIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.min(Math.max(index, 0), length - 1);
}

/** Converts a wheel/swipe delta into a step count, applying a threshold so
 * small trackpad jitter doesn't advance the stack. Returns -1, 0, or 1
 * (one slice per gesture "tick") to keep navigation deliberate. */
export function deltaToStep(delta: number, threshold = 24): -1 | 0 | 1 {
  if (Math.abs(delta) < threshold) return 0;
  return delta > 0 ? 1 : -1;
}

/** Given an array of items with an `addedAt` (ms epoch) field and the
 * current focus index, returns the 0-1 fractional position through the
 * timeline — used to place the current-position indicator on the rail. */
export function focusToRailFraction(focusIndex: number, length: number): number {
  if (length <= 1) return 0;
  return clampFocusIndex(focusIndex, length) / (length - 1);
}
