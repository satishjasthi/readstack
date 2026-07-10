# Workstream B — Notes

Time Machine UI, add-article form, and tag filter/list view are done and
building clean against workstream A's published types/hooks. Scope strictly
`src/ui/**` — did not touch `crypto.ts`, the GitHub sync client, `src/data/**`,
`src/hooks/**`, or `src/types/**`.

## What's in place

```
src/ui/timemachine/
  stackMath.ts          — pure geometry: computeSliceTransform, transformToCss,
                           clampFocusIndex, deltaToStep, focusToRailFraction
  StackCard.tsx          — single receding "slice"; click/Enter opens the article
                           in a new tab, shows CompletionBadge overlay
  useStackScroll.ts      — wheel (non-passive, debounced to one step per gesture)
                           + touch swipe + exposes focusIndex/setFocusIndex/stepBy
  TimeMachineStack.tsx   — composes StackCard + TimelineRail; also wires
                           ArrowUp/Down/Left/Right as an accessible alternative
                           to wheel/swipe; exports openArticleInNewTab()
  TimelineRail.tsx       — side rail: date ticks + current-position dot,
                           click-to-jump
  index.ts               — barrel

src/ui/article-form/
  AddArticleForm.tsx     — URL + title + tags; validates URL scheme and
                           non-empty title; emits NewArticleInput, does not
                           dispatch itself
  TagInput.tsx           — free-form tag chips, Enter/comma to commit, × to
                           remove, Backspace to pop last when input is empty
  TagFilterList.tsx      — tag cloud (derived from Article[]) + AND-filtered
                           flat list, each row shows CompletionBadge
  index.ts

src/ui/layout/
  AppShell.tsx           — header (title, Stack/Tags-list switcher, add-article
                           toggle, sync status indicator) + main view
  UnlockScreen.tsx       — passphrase prompt (first-run asks for confirm);
                           calls onUnlock(passphrase), does not call
                           useSessionKey() itself
  index.ts

src/ui/shared/
  CompletionBadge.tsx    — reads Article.completion/.status/.sessions;
                           renders "~72%" + tooltip when any session is
                           measurement:"estimated" (always true in v1 per A's
                           notes), vs plain "72%" for a hypothetical future
                           "measured" case — surfaces the brief's
                           estimated-vs-measured constraint rather than
                           presenting the number as exact
  TagPill.tsx            — shared chip used by TagInput, TagFilterList, StackCard
  format.ts              — formatCompletionPercent, statusLabel, formatShortDate
                           (native Intl, no date lib), hostnameOf
  index.ts

src/index.css — extended with all component styles (dark theme, CSS 3D
  transforms for .stack-card via perspective/translateZ/scale on
  .time-machine-stack__scene / .stack-card)
```

## Contract consumed (read-only)

- Types: `Article`, `NewArticleInput`, `ArticleStatus` (via `Article.status`),
  `ReadingSession.measurement` — from `../../types`, never redefined.
- Store: none of these components call `useDataStore()` directly. `AppShell`
  takes `articles`, `onAddArticle`, `isSubmitting`, `syncStatus`, `syncError`
  as props — the integration pass wires `useDataStore()` (`data.articles`,
  `dispatch({type: "ADD_ARTICLE", input})`, `syncStatus`, `syncError`) into
  those props in `App.tsx`. This keeps every component here testable/storybook-able
  without a live GitHub/crypto session.
- `UnlockScreen` takes `isFirstRun`/`onUnlock(passphrase)` as props; the
  integration pass decides whether to call `useSessionKey().unlockFresh` or
  `.unlockWithSalt` based on whether the initial pull 404'd (per A's
  syncEngine notes on first-run).

## Completion % — stubbed cleanly against the real contract

Did not need to stub anything fake: workstream A's `Article.completion` /
`Article.status` / `ReadingSession.measurement` fields already exist and are
correctly typed, and workstream C's `src/tracking/completionFormula.ts` has
also landed (visible on disk) computing real values via `APPLY_COMPLETION`.
`CompletionBadge` just renders whatever is on the `Article` object — no
placeholder math on my end.

## Interaction notes

- Wheel: debounced — accumulates `deltaY` until it crosses a 24px threshold,
  advances exactly one slice, then a 220ms cooldown before the next step, so
  a single trackpad flick doesn't fly through the whole stack.
- Touch: swipe-up advances forward, swipe-down goes back, same 24px threshold
  applied to touchstart→touchend Y delta.
- Keyboard: ArrowDown/Right advance, ArrowUp/Left go back, when the stack
  scene has focus (it's a `tabIndex={0}` container).
- Clicking a slice (`StackCard`) calls `onOpen(article)`, which
  `TimeMachineStack`/`AppShell` wire to `openArticleInNewTab()` —
  `window.open(article.url, "_blank", "noopener,noreferrer")`. Cards more
  than `maxVisibleSteps` (6) away from focus are `pointerEvents: none` and
  `tabIndex={-1}` so they can't be accidentally activated while hidden/faded.

## Build verification

`npm run build` (`tsc -b && vite build`) — **all `src/ui/**` files compile
with zero errors.** One pre-existing TS error remains in
`src/settings/usePersistedPat.ts` (line 59, `CryptoKey | null` not
assignable to `CryptoKey`) — that's workstream C's file, confirmed via
`find src/settings src/tracking ... -newer package.json` that it was written
by C's concurrent session, not by this workstream, and it does not import
anything from `src/ui/**`. Flagging for the integration/QA pass rather than
fixing myself, per the brief's ownership boundaries (I did not touch
`src/settings/**` or `src/tracking/**`).

One fix was needed on my side: `TimeMachineStack.tsx`'s scene `<div ref={containerRef}>`
needed a cast (`containerRef as React.RefObject<HTMLDivElement>`) because
`useStackScroll`'s ref type is `RefObject<HTMLDivElement | null>` (React 18
typings) vs the DOM attribute's stricter legacy ref type — cosmetic type-only
fix, no behavior change.

## Not done / left for integration or other workstreams

- `App.tsx` integration wiring (unlock → DataStoreProvider → AppShell) —
  deliberately left, per the brief, until this pass can see both B's
  AppShell/UnlockScreen (done) and C's SettingsScreen (also appears to have
  landed — `src/settings/*.tsx` present) together.
- Auto-fetching article title/word count from the URL — `AddArticleForm`
  requires the user to type a title; auto-fetch is best-effort/CORS-limited
  per the brief and not blocking for v1.
- Component/interaction tests (`vitest`/`@testing-library` are pinned in
  `package.json` but I did not author `.test.tsx` files for these — flagging
  for the QA subagent per the brief's delegation plan, since I was not asked
  to author tests, only to confirm no TypeScript errors).
