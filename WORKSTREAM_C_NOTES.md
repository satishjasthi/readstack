# Workstream C — Notes

Completion-tracking heuristic, article-open tracking flow, word-count
extraction, and the Settings screen are done. Scope strictly `src/tracking/**`
and `src/settings/**` — did not touch `src/ui/**` (workstream B), and only
*consumed* (never redefined) workstream A's `src/types`, `src/hooks`,
`src/crypto`, `src/data`, `src/utils`.

## What's in place

```
src/tracking/
  completionFormula.ts      — pure computeCompletion(inputs): CompletionResult.
                               Extensively documented: WHY it's an estimate
                               (cross-origin new-tab constraint from the brief),
                               the exact formula, and 4 worked numeric examples
                               verified against the real implementation (not
                               just hand-derived).
  completionFormula.test.ts — 14 vitest unit tests: the brief's skim case
                               (100% scroll in 3s -> "skimmed", not completed/
                               in-progress), a genuine "completed" case, a
                               genuine "in-progress" case, an "unread" case,
                               rampBetween/clamp01 edge cases, divide-by-zero
                               safety (expectedMs=0), and monotonicity
                               properties in both activeMs and scrollDepth.
  visibilityTracker.ts      — startVisibilityTracking(): accumulates active
                               ms while document.visibilityState==="visible"
                               (via visibilitychange/blur/focus), the proxy
                               signal for "time spent reading" since we can't
                               observe the external tab.
  wordCountEstimate.ts      — estimateWordCount(url): best-effort fetch +
                               stripHtmlToText (regex-based tag/script/style
                               stripping) + countWords (A's utility). Never
                               throws — resolves {failed:true, reason} on any
                               fetch error (CORS is the expected common case,
                               not an edge case) so callers always have a
                               deterministic fallback path to manual entry.
  useReadingSession.ts      — the article-open tracking flow: openArticle()
                               opens the URL in a new tab, dispatches
                               START_SESSION, starts a visibility tracker,
                               and best-effort resolves word count via
                               SET_WORD_COUNT if not already known.
                               Recomputes + persists (UPDATE_SESSION +
                               APPLY_COMPLETION) on a 15s interval (default,
                               configurable), on return-to-app
                               (visibilitychange/focus), and via
                               reportScrollDepth() for the v1 self-reported
                               scroll signal. closeSession() does one final
                               recompute+persist and tears down the tracker/
                               interval. All persistence goes through
                               useDataStore().dispatch — no direct calls into
                               src/crypto or src/github from this module.
  index.ts                  — barrel

src/settings/
  usePersistedPat.ts   — GitHub PAT storage. Encrypted with the session key
                         via A's src/crypto (encryptWithKey/decryptWithKey)
                         and stored in sessionStorage as an EncryptedPayload
                         JSON blob — per A's notes, A deliberately left this
                         to C. Decrypts on mount once a sessionKey is
                         available; treats any decrypt failure (wrong/
                         rotated key, nothing stored) as "no PAT" rather than
                         surfacing an error, since that's the common
                         "not configured yet" case.
  PatField.tsx         — token input (masked by default, show/hide toggle),
                         never echoes a previously-stored token back into the
                         DOM — field always starts empty.
  PassphraseField.tsx  — passphrase entry, "fresh" (create + confirm) vs
                         "unlock" (single field) modes; hands the raw
                         passphrase to a caller-supplied onSubmit rather than
                         calling useSessionKey itself, so it's reusable at
                         the integration layer for both first-run and
                         returning-user flows.
  ReadingSpeedField.tsx — wpm number input, clamped [50, 1000], commits on
                         blur.
  SettingsScreen.tsx   — composes the three fields. Wires PassphraseField to
                         useSessionKey().unlockFresh/unlockWithSalt, PatField
                         to usePersistedPat, ReadingSpeedField to A's
                         usePersistedSettings AND (if a DataStoreProvider
                         happens to be mounted) dispatch({type:
                         "UPDATE_SETTINGS"}) so the change also syncs to the
                         encrypted data file. Tolerates being rendered
                         without a DataStoreProvider (pre-unlock) via a
                         try/catch around useDataStore() — settings entered
                         before the store loads are still captured locally.
  index.ts             — barrel
```

## The completion formula — final form

```
timeRatio  = activeMs / expectedMs
timeCredit = rampBetween(timeRatio, lo=0.15, hi=0.60)   // 0→1 linear ramp
timeWeightedScroll = scrollDepth * timeCredit
completion = clamp01(0.5 * timeWeightedScroll + 0.5 * timeCredit)
status:
  completion >= 0.90                        -> "completed"
  completion >= 0.35                        -> "in-progress"
  scrollDepth > 0.80 && timeCredit < 0.34    -> "skimmed"
  otherwise                                  -> "unread"
```

Note this ended up simpler than the plan doc's pseudocode: the plan's
`min(blended, timeCredit + (1-timeCredit)*scrollDepth)` cap term was
tested during implementation and is mathematically **never** tighter than
`blended` once scroll is time-weighted first (both terms share the same
`timeCredit` factor) — verified by a 200,000-sample property check across
the input space before I dropped it. Keeping dead code that never activates
would have been misleading in a "formula to be defined, documented in code
comments" deliverable, so I simplified to just `completion = blended` and
updated the docblock's worked examples to the actual verified numbers
(the plan doc's own worked example, "~0.20 completion", was a hand-estimate
that doesn't match either the plan's own pseudocode or mine when computed
exactly — the real skim-case answer is 0.0, which is arguably a *better*
outcome for that case, not worse).

## Verification performed

- `npx tsc -b --noEmit` — clean across the whole project (A + B + C
  combined), including one pre-existing error B's notes flagged in
  `usePersistedPat.ts` (`CryptoKey | null` narrowing not surviving into a
  nested async closure) — fixed by capturing a non-null local before the
  closure.
- `npx vitest run` — `src/tracking/completionFormula.test.ts`: **14/14
  tests passing.** Covers the brief's explicit skim-detection requirement,
  completed/in-progress/unread classification, rampBetween/clamp01 edges,
  divide-by-zero safety, and monotonicity.
- `npm run build` (`tsc -b && vite build`) — succeeds; only 31 modules
  bundled since `src/App.tsx` is still A's bare shell (integration pass not
  yet run) — tracking/settings modules aren't imported from the entry point
  yet, so this is expected, not a bug. The `tsc -b` project-wide type-check
  (which does cover these files regardless of import graph) is the
  meaningful signal here and is clean.
- Cleaned up `dist/` and `*.tsbuildinfo` after verification (both
  gitignored, not committed).

## Things A/integration-pass should know

- `useReadingSession` calls `useDataStore()` internally (not optional) — it
  must be rendered under `<DataStoreProvider>`. `SettingsScreen` by
  contrast tolerates being rendered without one, since the brief's flow
  needs Settings (for entering the PAT/passphrase) available *before* a
  provider can exist.
- `ReadingSession.measurement` is hardcoded to `"estimated"` wherever this
  workstream creates a session — never `"measured"` (that's reserved for
  the v2 bookmarklet stretch goal, out of scope here).
- `estimateWordCount` failures are silent-by-design (no dispatch, no
  thrown error) — the manual word-count entry field is the real fallback
  UI, and per the brief that's expected to be common, not exceptional. If
  B/integration wants a visible "couldn't auto-detect word count" hint,
  the `reason` string is available from `estimateWordCount`'s return value
  for whoever wires the article-form UI to call it directly (I did not
  wire it into `AddArticleForm` myself since that file is B's).
- `SettingsScreen` assumes `usePersistedSettings`'s plain settings
  (owner/repo/path/branch/readingSpeedWpm) and this workstream's encrypted
  PAT are assembled together into a `GitHubFileClientConfig` at the
  integration layer (per A's notes) — this screen does not construct that
  config itself, only exposes the pieces.

## Not done / explicitly out of scope

- `App.tsx` integration wiring — left for the final integration pass, same
  as A and B both note.
- Any Time Machine UI (workstream B's scope) — did not touch `src/ui/**`.
- A visible "auto-detect failed" UI affordance in the add-article flow —
  the underlying signal (`WordCountEstimateResult.reason`) exists;
  surfacing it in `AddArticleForm` is B's file to edit.
