import { describe, expect, it } from "vitest";
import { clamp01, computeCompletion, rampBetween } from "./completionFormula";
import type { CompletionInputs } from "../types";

/** 2000-word article at 200wpm => (2000/200)*60_000 = 600_000ms. */
const EXPECTED_MS_2000_WORDS_200WPM = 600_000;

function inputs(overrides: Partial<CompletionInputs>): CompletionInputs {
  return {
    scrollDepth: 0,
    activeMs: 0,
    expectedMs: EXPECTED_MS_2000_WORDS_200WPM,
    ...overrides,
  };
}

describe("rampBetween", () => {
  it("returns 0 at or below lo", () => {
    expect(rampBetween(0, 0.15, 0.6)).toBe(0);
    expect(rampBetween(0.15, 0.15, 0.6)).toBe(0);
    expect(rampBetween(0.05, 0.15, 0.6)).toBe(0);
  });

  it("returns 1 at or above hi", () => {
    expect(rampBetween(0.6, 0.15, 0.6)).toBe(1);
    expect(rampBetween(1, 0.15, 0.6)).toBe(1);
  });

  it("interpolates linearly in between", () => {
    // midpoint of [0.15, 0.6] is 0.375
    expect(rampBetween(0.375, 0.15, 0.6)).toBeCloseTo(0.5, 5);
  });
});

describe("clamp01", () => {
  it("clamps below 0 and above 1", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  it("passes through in-range values", () => {
    expect(clamp01(0.42)).toBe(0.42);
  });

  it("treats NaN as 0", () => {
    expect(clamp01(NaN)).toBe(0);
  });
});

describe("computeCompletion", () => {
  // Worked example A from the brief: scrolled 100% in 3 seconds on a
  // 2000-word article. Must NOT read as completed or in-progress — the
  // whole point of the formula's time-credit gate is to catch this.
  it("classifies a fast 100%-scroll skim as 'skimmed', not 'completed'", () => {
    const result = computeCompletion(
      inputs({ scrollDepth: 1.0, activeMs: 3_000, expectedMs: EXPECTED_MS_2000_WORDS_200WPM }),
    );

    expect(result.completion).toBeCloseTo(0, 5);
    expect(result.status).toBe("skimmed");
    expect(result.status).not.toBe("completed");
    expect(result.status).not.toBe("in-progress");
  });

  // Worked example B: high scroll depth AND active time comfortably over
  // the expected reading time -> should read as genuinely completed.
  it("classifies high scroll depth + sufficient active time as 'completed'", () => {
    const result = computeCompletion(
      inputs({ scrollDepth: 0.95, activeMs: 650_000, expectedMs: EXPECTED_MS_2000_WORDS_200WPM }),
    );

    expect(result.completion).toBeCloseTo(0.975, 5);
    expect(result.status).toBe("completed");
  });

  // Worked example C: partial scroll, partial time (mid-ramp) -> in-progress.
  it("classifies partial scroll + mid-ramp active time as 'in-progress'", () => {
    const result = computeCompletion(
      inputs({ scrollDepth: 0.45, activeMs: 240_000, expectedMs: EXPECTED_MS_2000_WORDS_200WPM }),
    );

    expect(result.completion).toBeCloseTo(0.4028, 3);
    expect(result.status).toBe("in-progress");
  });

  // Worked example D: untouched article -> unread, not skimmed (scrollDepth
  // must exceed the skim threshold for the skim label to apply).
  it("classifies an untouched article as 'unread'", () => {
    const result = computeCompletion(inputs({ scrollDepth: 0, activeMs: 0 }));

    expect(result.completion).toBe(0);
    expect(result.status).toBe("unread");
  });

  it("never returns a completion outside [0, 1]", () => {
    const result = computeCompletion(
      inputs({ scrollDepth: 1, activeMs: 10_000_000, expectedMs: 1 }),
    );
    expect(result.completion).toBeGreaterThanOrEqual(0);
    expect(result.completion).toBeLessThanOrEqual(1);
  });

  it("treats expectedMs = 0 (e.g. unknown word count) as zero time credit rather than dividing by zero", () => {
    const result = computeCompletion(inputs({ scrollDepth: 0.5, activeMs: 5_000, expectedMs: 0 }));
    expect(Number.isFinite(result.completion)).toBe(true);
    expect(result.completion).toBe(0);
  });

  it("is monotonically non-decreasing in activeMs, holding scrollDepth fixed", () => {
    const low = computeCompletion(inputs({ scrollDepth: 0.7, activeMs: 50_000 }));
    const high = computeCompletion(inputs({ scrollDepth: 0.7, activeMs: 400_000 }));
    expect(high.completion).toBeGreaterThanOrEqual(low.completion);
  });

  it("is monotonically non-decreasing in scrollDepth, holding activeMs fixed", () => {
    const low = computeCompletion(inputs({ scrollDepth: 0.1, activeMs: 300_000 }));
    const high = computeCompletion(inputs({ scrollDepth: 0.9, activeMs: 300_000 }));
    expect(high.completion).toBeGreaterThanOrEqual(low.completion);
  });
});
