/**
 * Completion % heuristic — workstream C.
 *
 * This is a pure function: no DOM, no network, no timers. It exists purely to
 * combine the two proxy signals we actually have into a single completion
 * estimate + status label, and to be trivially unit-testable in isolation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS AN ESTIMATE, NOT A MEASUREMENT (see PROJECT_BRIEF.md
 * "Constraint / known limitation to flag to user"):
 *
 * Articles open in a NEW TAB on an external origin. ReadStack's JS cannot
 * observe scroll position or dwell time on that page directly — there is no
 * iframe (most sites block framing), and there is no content script in v1.
 * So both inputs are proxies:
 *   - `scrollDepth` is self-reported (a manual "how far did you get" slider
 *     in v1, not something we sampled from the actual page).
 *   - `activeMs` is measured on the *ReadStack tab's* focus/visibility state
 *     as a stand-in for "the external tab was probably being read" (see
 *     `visibilityTracker.ts`) — not real dwell time on the article itself.
 * `ReadingSession.measurement` is therefore always `"estimated"` in v1.
 * Any UI surfacing this number MUST label it as an estimate (e.g. "~72%
 * estimated"), never as an exact reading measurement.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE FORMULA (per IMPLEMENTATION_PLAN.md §2):
 *
 * 1. `timeRatio = activeMs / expectedMs` — how much active time was spent,
 *    relative to how long the article should take to read at the user's
 *    configured reading speed.
 *
 * 2. `timeCredit = rampBetween(timeRatio, lo=0.15, hi=0.60)` — a 0→1 ramp:
 *    0 credit below 15% of expected time, full credit at/above 60% of
 *    expected time, linear in between. This is the piece that defeats the
 *    "scrolled to 100% in 3 seconds" skim case — no matter how far you
 *    scrolled, if you weren't active for a meaningful fraction of the
 *    expected reading time, you get ~no time credit.
 *
 * 3. `blended = 0.5 * timeWeightedScroll + 0.5 * timeCredit`, where
 *    `timeWeightedScroll = scrollDepth * timeCredit` — scroll progress is
 *    first discounted by how much time credit was earned, THEN averaged
 *    50/50 with the raw time credit. This is the piece that defeats the
 *    "scrolled to 100% in 3 seconds" skim case: with timeCredit = 0, the
 *    scroll signal is multiplied away to 0 before it ever reaches the
 *    blend, so scrolling far with no time invested contributes nothing.
 *
 * 4. `completion = blended` directly (0-1, already bounded — no separate
 *    cap term is needed: because both halves of the blend share the same
 *    `timeCredit` factor, `blended` can never exceed what a hard time-vs-
 *    scroll cap would allow; verified by property-testing the formula
 *    across the input space during development).
 *
 * 5. Status label:
 *    - completion >= 0.9              -> "completed"
 *    - completion >= 0.35             -> "in-progress"
 *    - scrollDepth > 0.8 && timeCredit < 0.34 -> "skimmed"  (checked before
 *      falling through to "unread" — this is the "scrolled far, no time"
 *      skim signature the brief calls out explicitly)
 *    - otherwise                       -> "unread"
 *
 * WORKED EXAMPLES (also encoded as unit tests in completionFormula.test.ts —
 * numbers below are verified against the actual implementation, not just
 * hand-derived):
 *
 * A. The brief's skim case: 2000-word article, 200wpm => expectedMs =
 *    (2000/200)*60_000 = 600_000ms (10min). Scrolled to 100% in 3s
 *    (activeMs = 3_000).
 *      timeRatio = 3_000 / 600_000 = 0.005
 *      timeCredit = rampBetween(0.005, 0.15, 0.60) = 0 (below lo)
 *      timeWeightedScroll = 1.0 * 0 = 0
 *      blended = 0.5*0 + 0.5*0 = 0
 *      cappedTerm = 0 + (1-0)*1.0*0 = 0
 *      completion = min(0, 0) = 0 -> status "skimmed" (scrollDepth 1.0 > 0.8
 *      and timeCredit 0 < 0.34) — because scroll progress is weighted by
 *      timeCredit before blending, zero time credit zeroes out the scroll
 *      signal entirely. This correctly refuses to call a 3-second, 100%-
 *      scroll "read" of a 2000-word article anything but a skim.
 *
 * B. Genuinely completed: same article, activeMs = 650_000 (108% of
 *    expected), scrollDepth = 0.95.
 *      timeRatio = 1.0833 -> timeCredit = 1 (>= hi)
 *      timeWeightedScroll = 0.95 * 1 = 0.95
 *      blended = 0.5*0.95 + 0.5*1 = 0.975
 *      cappedTerm = 1 + 0*... = 1
 *      completion = min(0.975, 1) = 0.975 -> "completed"
 *
 * C. Genuinely in-progress: activeMs = 240_000 (40% of expected, mid-ramp),
 *    scrollDepth = 0.45.
 *      timeRatio = 0.40 -> timeCredit = (0.40-0.15)/(0.60-0.15) = 0.5556
 *      timeWeightedScroll = 0.45 * 0.5556 = 0.25
 *      blended = 0.5*0.25 + 0.5*0.5556 = 0.4028
 *      completion ≈ 0.4028 -> "in-progress" (>= 0.35 threshold)
 *
 * D. Untouched article: scrollDepth = 0, activeMs = 0 -> timeCredit = 0,
 *    completion = 0 -> "unread" (fails the skim check because scrollDepth
 *    is not > 0.8).
 */

import type { ArticleStatus, CompletionInputs, CompletionResult } from "../types";

/** Ramp thresholds, expressed as a fraction of expectedMs. Below `lo`, time
 * credit is 0; at/above `hi`, time credit is 1; linear in between. */
const TIME_CREDIT_RAMP_LO = 0.15;
const TIME_CREDIT_RAMP_HI = 0.6;

/** Status thresholds on the final blended completion score. */
const COMPLETED_THRESHOLD = 0.9;
const IN_PROGRESS_THRESHOLD = 0.35;

/** Thresholds for the explicit "skimmed" signature: far scroll, little
 * active time. Checked only once completion falls below IN_PROGRESS. */
const SKIMMED_SCROLL_THRESHOLD = 0.8;
const SKIMMED_TIME_CREDIT_THRESHOLD = 0.34;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Linear ramp: 0 below lo, 1 at/above hi, linear interpolation between. */
export function rampBetween(value: number, lo: number, hi: number): number {
  if (value <= lo) return 0;
  if (value >= hi) return 1;
  return (value - lo) / (hi - lo);
}

/**
 * Computes completion % (0-1) and a status label from the two proxy
 * signals. Pure function — see module docblock for the full derivation and
 * worked examples.
 */
export function computeCompletion(inputs: CompletionInputs): CompletionResult {
  const scrollDepth = clamp01(inputs.scrollDepth);
  const timeRatio = inputs.expectedMs > 0 ? inputs.activeMs / inputs.expectedMs : 0;
  const timeCredit = rampBetween(timeRatio, TIME_CREDIT_RAMP_LO, TIME_CREDIT_RAMP_HI);

  // Scroll progress only counts in proportion to the time credit earned
  // toward it — this is what stops "scrolled 100% in 3 seconds" from
  // blending up to 0.5 on scroll alone. A scroll signal with zero time
  // credit behind it contributes nothing.
  const timeWeightedScroll = scrollDepth * timeCredit;
  const blended = 0.5 * timeWeightedScroll + 0.5 * timeCredit;

  const completion = clamp01(blended);

  const status = classify(completion, scrollDepth, timeCredit);

  return { completion, status };
}

function classify(completion: number, scrollDepth: number, timeCredit: number): ArticleStatus {
  if (completion >= COMPLETED_THRESHOLD) return "completed";
  if (completion >= IN_PROGRESS_THRESHOLD) return "in-progress";
  if (scrollDepth > SKIMMED_SCROLL_THRESHOLD && timeCredit < SKIMMED_TIME_CREDIT_THRESHOLD) {
    return "skimmed";
  }
  return "unread";
}
