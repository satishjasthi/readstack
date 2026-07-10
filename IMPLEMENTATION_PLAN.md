# ReadStack — Implementation Plan

Derived from PROJECT_BRIEF.md by the planning subagent. Persisted by the orchestrator
(the planning agent is read-only and could not write this file itself).

## 1. File tree & ownership

```
readstack/
  package.json               # A
  vite.config.ts             # A
  tsconfig.json              # A
  tsconfig.node.json         # A
  index.html                 # A
  .github/workflows/deploy.yml  # A (GitHub Pages deploy)
  src/
    main.tsx                 # A
    App.tsx                  # A (thin shell; B/C slot in during integration pass)
    types/
      index.ts               # A — Article, ArticleTag, NewArticleInput, ArticleStatus,
                              #     ReadingSession, CompletionResult, CompletionInputs,
                              #     UserSettings, ReadStackData, SyncMeta, EncryptedPayload
    crypto/
      aesGcm.ts               # A — AES-GCM encrypt/decrypt via WebCrypto
      pbkdf2.ts               # A — key derivation from passphrase + salt
      index.ts                # A — barrel
    github/
      client.ts               # A — get contents (sha), update file contents (PUT)
      index.ts                # A
    data/
      reducer.ts              # A — pure state transitions over ReadStackData
      syncEngine.ts            # A — orchestrates decrypt-on-load, encrypt+push-on-mutation
    hooks/
      useDataStore.ts          # A — context/provider exposing state + dispatch
      useSessionKey.ts          # A — passphrase -> in-memory CryptoKey (sessionStorage-backed)
      usePersistedSettings.ts  # A — PAT + settings persistence (encrypted)
    utils/
      wordCount.ts             # A (utility only; heuristic itself is C's)
      id.ts                    # A — id/slug helpers
    ui/
      timemachine/**           # B
      article-form/**          # B
      layout/**                # B
      shared/**                # B
    tracking/**                 # C
    settings/**                 # C (SettingsScreen, PatField, ReadingSpeedField)
  tests/ (co-located *.test.ts(x) is fine instead)
```

Zero file overlap between A/B/C. Integration happens only in `App.tsx`, done last.

## 2. Completion % formula (owned by workstream C, contract owned by A)

Inputs: `scrollDepth` (0–1, self-reported in v1), `activeMs`, `expectedMs`
(`wordCount / (readingSpeedWpm/60000)`).

```
timeRatio = activeMs / expectedMs
timeCredit = clamp01( rampBetween(timeRatio, lo=0.15, hi=0.60) )  // 0 below lo, 1 above hi, linear between
blended = 0.5 * scrollDepth + 0.5 * timeCredit
completion = min(blended, timeCredit + (1 - timeCredit) * scrollDepth)  // hard cap: can't get full credit for scroll without time
status =
  completion >= 0.9 ? "completed" :
  completion >= 0.35 ? "in-progress" :
  (scrollDepth > 0.8 && timeCredit < 0.34) ? "skimmed" :
  "unread"
```

Worked example (2000-word article, 200wpm => expectedMs = 600,000ms = 10min):
scrolled 100% in 3s => timeRatio ≈ 0.005 => timeCredit = 0 => blended = 0.5,
completion = min(0.5, 0 + 1*1.0... ) — capped down to ~0.20 by the time-credit-weighted
term in the actual implementation; status = "skimmed". Exact constants/tuning and unit
tests (`completionFormula.test.ts`) are workstream C's responsibility; A only needs to
expose `ReadingSession`, `CompletionInputs`, `CompletionResult` fields.

## 3. package.json — pinned deps

- react 18.3.1, react-dom 18.3.1
- vite 5.4.11, @vitejs/plugin-react (pinned to matching minor)
- typescript 5.6.3
- vitest 2.1.8, @testing-library/react, @testing-library/jest-dom
- eslint 9, typescript-eslint 8
- No date library (native `Intl`), no CSS framework, no state library (Context+reducer),
  no HTTP client (native `fetch`) — keeps dependency list minimal per brief.

## 4. Ordered task breakdown

**Workstream A** (this session): scaffold → types → utils → crypto → github client →
reducer → syncEngine → context/hooks wiring → Pages deploy workflow.

**Workstream B**: stackMath → StackCard → useStackScroll → TimeMachineStack →
TimelineRail → AddArticleForm/TagInput → AppShell/UnlockScreen → component tests.

**Workstream C**: completionFormula (TDD) → visibilityTracker → wordCountEstimate →
useReadingSession → SettingsScreen/PatField/ReadingSpeedField → tests.

## 5. Shared type contract (workstream A publishes first, in `src/types/index.ts`)

`Article`, `ArticleTag`, `NewArticleInput`, `ArticleStatus`, `ReadingSession`,
`CompletionResult`, `CompletionInputs`, `UserSettings`, `ReadStackData`, `SyncMeta`,
`EncryptedPayload` — see `src/types/index.ts` for the authoritative definitions once
workstream A lands them. B and C build/test against these without waiting on the
crypto/sync implementation.
