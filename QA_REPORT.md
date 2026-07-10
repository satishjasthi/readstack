# ReadStack — QA Report

Scope: integration verification of workstreams A (scaffold/crypto/sync/data model),
B (Time Machine UI), and C (completion tracking/settings), per PROJECT_BRIEF.md and
IMPLEMENTATION_PLAN.md. No git commits or pushes were made.

## Summary

The biggest finding wasn't a type mismatch — it was that **integration had not actually
happened yet**. All three workstream notes (A, B, C) explicitly deferred `App.tsx`
wiring to "the integration pass," so the app as handed off was still A's placeholder
shell:

```
<div className="app-shell">
  <h1>ReadStack</h1>
  <p>Scaffold ready — UI pending...</p>
</div>
```

`npm run build` on the untouched tree passed and reported **31 modules** — which,
read carefully, is a red flag rather than a clean signal: it means none of B's
`src/ui/**` or C's `src/tracking/**`/`src/settings/**` code was even reachable from
the entry point, so a "clean build" up to that point was only validating A's code
in isolation (plus type-checking B/C via `tsc -b`'s project-wide check, which doesn't
require reachability). I did the integration wiring myself as part of this QA pass,
since it's exactly the kind of cross-workstream gap this task asked me to close, and
verified the bundle grew to a real, wired application.

## What passed

- **(a) Build — zero TypeScript errors.** `npm run build` (`tsc -b && vite build`)
  exits 0 with no diagnostics, both before and after my integration changes.
- **(b) Completion % unit tests — all pass.** `npx vitest run` →
  `src/tracking/completionFormula.test.ts`: **14/14 passing**, unchanged by this
  pass (no fixes needed — covers skim/completed/in-progress/unread classification,
  rampBetween/clamp01 edges, divide-by-zero safety, monotonicity).
- **(c) No unhandled exceptions on load.** Verified with a headless Playwright
  Chromium session against `npm run dev`:
  - Fresh load (no PAT/owner entered): renders the gated pre-unlock screen
    (Settings + GitHub owner field + PAT bootstrap + "configure settings" prompt).
    Zero `pageerror` events, zero uncaught exceptions.
  - Entering a GitHub owner + a token and triggering the repo probe: makes a real
    `GET https://api.github.com/repos/.../contents/...` call, gets a 401 (expected —
    the smoke-test token isn't real), and the UI surfaces this as
    `"Could not reach readstack-data: GitHub getFileContents failed: 401"` rather
    than crashing. Zero uncaught exceptions. The 401 appears only as an expected
    network-response console log, not a JS error.
  - Confirmed via bundle inspection that B's and C's code is genuinely included and
    reachable post-wiring: the built `dist/assets/*.js` contains B's
    `time-machine-stack` CSS class string and C's `"skimmed"` status string, and
    module count went from 31 → **74** after wiring `App.tsx`.
  - Could not exercise the fully-unlocked `AppShell`/`TimeMachineStack` render with
    real data end-to-end, since that requires a genuine GitHub PAT + an actual
    `readstack-data` repo (out of scope for this pass — no real credentials were
    used or requested, per "do not push/commit" and general credential-safety
    practice). The unlock → provider → load → render code path is exercised by the
    type checker and by the pre-unlock flow up to the point a real network 200
    response would be required; I did not fabricate a mock server, since the brief
    says a mocked-GitHub-API end-to-end test is explicitly a QA-subagent
    responsibility (not yet built — see Known Gaps).

## What was fixed (integration layer only, no feature redesign)

1. **`src/App.tsx` — full integration wiring (rewritten from A's placeholder).**
   Implements the flow all three workstreams' notes described but left undone:
   - Pre-unlock: collect GitHub owner + PAT, probe `readstack-data` via
     `getFileContents` to read the *unencrypted* `salt`/`iterations` fields off the
     `EncryptedPayload` wrapper (no key needed for this, since only `ciphertext` is
     opaque) to decide first-run (404) vs returning-user, without asking the user to
     guess.
   - Render B's `UnlockScreen` with the correct `isFirstRun` mode; on submit, derive
     the key via A's `useSessionKey().unlockFresh`/`unlockWithSalt`.
   - Mount A's `<DataStoreProvider>` with the assembled `GitHubFileClientConfig` +
     derived key/salt/iterations, call `load()`, then render B's `AppShell`.
   - Wire `AppShell`'s `onAddArticle` to `dispatch({ type: "ADD_ARTICLE", input })`.
   - Wire article-open handling to **C's `useReadingSession().openArticle`** (which
     starts real completion tracking: `START_SESSION`, visibility tracking, periodic
     recompute) instead of B's bare `openArticleInNewTab` (which just does
     `window.open` with no tracking side effect). This was an easy miswiring to make
     since both functions have compatible signatures — using the untracked one would
     have silently defeated the brief's entire completion-tracking feature at the
     integration layer even though A/B/C's individual code was all correct.

2. **`src/ui/layout/AppShell.tsx` — added optional `onOpenArticle` prop.**
   `AppShell` hardcoded `openArticleInNewTab` with no way for the integration layer
   to substitute the tracked version. Added `onOpenArticle?: (article: Article) => void`,
   defaulting to the existing untracked behavior so `AppShell` is still usable
   standalone/in tests without a store — a minimal, additive, non-breaking change
   (verified: no other caller sets this prop, so default behavior is unchanged
   everywhere else).

3. **Missing GitHub owner/repo/branch/path input (integration-layer gap, not
   fixed by editing C's `SettingsScreen.tsx`).** `usePersistedSettings` (A) already
   models `githubOwner`/`githubRepo`/`githubBranch`/`dataFilePath`, and
   `SettingsScreen`'s own doc comment claims to cover "githubOwner/repo/path/branch,"
   but **no settings component actually renders an input for them** — only
   `ReadingSpeedField` exists. Without this, `githubOwner` stays `""` forever and the
   app can never assemble a `GitHubFileClientConfig`, so it could never reach the
   unlock step at all. Rather than edit C's owned `SettingsScreen.tsx` (out of scope
   per the workstream boundaries this task asked me to respect), I added a small
   `GitHubRepoBootstrap` component inside `App.tsx` itself (the integration layer I
   own) that reads/writes through A's existing `usePersistedSettings.updateSettings`.
   Flagging this doc/code mismatch in C's `SettingsScreen.tsx` for a follow-up, since
   the real fix is probably to add these fields to C's screen itself rather than
   have them live awkwardly in `App.tsx`.

No changes were needed to `src/tracking/**`, `src/settings/usePersistedPat.ts`,
`src/data/**`, `src/crypto/**`, `src/github/**`, or `src/types/**` — all three
workstreams' own fixes (B's ref-type cast, C's `usePersistedPat` narrowing fix) were
already in place and verified clean.

## Tests

- `npx vitest run`: **14/14 passing**, all in `src/tracking/completionFormula.test.ts`.
  No failing tests found — nothing needed fixing, and none of C's documented
  deviations from the plan's pseudocode (dropping the redundant hard-cap term,
  correcting the "~0.20" hand-estimate to the verified 0.0) look wrong on inspection;
  C's notes include a property-check justification (200,000-sample sweep) for why
  the simplification is mathematically equivalent, and the test suite's skim-case
  assertion (`status === "skimmed"`, not an exact completion-value equality) is
  consistent with treating completion as an estimate rather than a precise figure,
  matching the brief's own framing.
- No component/interaction tests exist yet for `src/ui/**` or `src/settings/**`
  (see Known Gaps) — B's and C's notes both explicitly flagged this as intentionally
  left for the QA pass; I did not author new tests in this pass beyond the
  integration-smoke verification described above, to stay within "fix wiring, don't
  redesign or take on a full test-authoring pass" scope. Flagging as a real gap
  below rather than silently skipping it.

## Known gaps (not bugs — expected/out of scope for this pass)

- **New-tab tracking limitation is expected, not a bug.** Per the brief and C's
  notes, `ReadingSession.measurement` is hardcoded to `"estimated"` in v1 — ReadStack
  cannot observe scroll/dwell on the external tab cross-origin. B's `CompletionBadge`
  correctly surfaces this ("~72%" + tooltip) rather than presenting it as exact. This
  is documented behavior, not a defect.
- **No component/interaction tests for `src/ui/**` or `src/settings/**`.** Both B
  and C explicitly deferred these to the QA subagent. Given this pass's scope was
  "fix integration issues + run existing tests," I did not author a new test suite
  from scratch; a follow-up pass should add `@testing-library/react` tests for
  `AddArticleForm`, `TagInput`/`TagFilterList`, `TimeMachineStack`/`useStackScroll`,
  and `SettingsScreen`, since the dependencies are already pinned in `package.json`.
- **No mocked-GitHub-API end-to-end test.** The brief's delegation plan calls for
  the QA subagent to "verify end-to-end flow with a mocked GitHub API." This pass
  verified the flow structurally (build, headless load, probe-against-real-API
  graceful-failure) but did not stand up a mock server/MSW harness to drive a full
  unlock → load → add-article → sync round trip. Recommended follow-up: add `msw` or
  a simple fetch-mock and a Playwright/RTL test exercising first-run creation and
  returning-user unlock against a fake `readstack-data` file.
- **`GitHubRepoBootstrap`'s UX is minimal** (plain owner/repo/branch/path inputs
  bolted directly into `App.tsx`, styled with the generic `.settings-field` class).
  It's functionally correct and unblocks the flow, but the natural home for these
  fields is inside C's `SettingsScreen.tsx` alongside PAT/passphrase/reading-speed —
  flagging as a design cleanup, not a defect, since moving it is a C-owned file
  change outside this pass's "small integration fixes only" mandate.
- **PAT is entered twice in the pre-unlock flow** (once in the lightweight
  `PatBootstrap` used to probe the repo before a session key exists, once more via
  `SettingsScreen`'s `PatField` once a key does exist, so it can be persisted
  encrypted for the rest of the browser session). This is a deliberate consequence
  of the brief's own constraint (PAT storage must be encrypted with the
  passphrase-derived key, but the PAT is needed *before* the passphrase step to even
  determine first-run vs returning-user) rather than an oversight — documented in
  `App.tsx`'s `PatBootstrap` comment. A nicer UX (e.g. deferring the repo-probe until
  after passphrase entry, accepting one extra round trip) is possible but changes
  the interaction flow, so left as-is for this pass rather than redesigned.

## Verification commands run

```
npm install                 # clean, 298 packages, 0 new peer issues
npm run build                # tsc -b && vite build — 0 errors, 74 modules (was 31 pre-fix)
npx vitest run                # 14/14 tests passing
npm run dev + headless Playwright Chromium checks:
  - fresh load: 0 pageerror events
  - PAT-only entered (no owner): stays correctly gated, 0 pageerror events
  - owner+PAT entered, probe hits real api.github.com, gets 401, surfaces
    gracefully as text, 0 pageerror events
  - bundle inspection: dist/assets/*.js contains "time-machine-stack" (B) and
    "skimmed" (C), confirming both workstreams are wired into the real bundle
```

`dist/`, `*.tsbuildinfo`, and all temporary Playwright smoke-test scripts (created
under `/tmp`, outside the repo) were removed after verification. No files were
committed or pushed; `git status` in the repo shows only the pre-existing untracked
working tree (no commits exist yet in this repo).
