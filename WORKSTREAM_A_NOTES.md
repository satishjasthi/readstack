# Workstream A — Notes for B & C

Scaffold, types, crypto, GitHub sync, and the data store are done and building
clean (`npm run build` passes: `tsc -b && vite build`, verified after fixing a
`vite.config.ts` type issue and a stray-build-artifact issue from `tsconfig.node.json`
missing `noEmit`).

## What's in place

```
package.json, vite.config.ts, tsconfig*.json, index.html   — scaffold
src/main.tsx, src/App.tsx, src/index.css, src/vite-env.d.ts — bare app shell
src/types/index.ts                — full shared data model (read this first)
src/crypto/{pbkdf2,aesGcm}.ts     — AES-GCM + PBKDF2 via WebCrypto
src/github/client.ts              — GitHub REST: getFileContents, updateFileContents
src/data/{reducer,syncEngine}.ts  — pure reducer + pull/push orchestration
src/utils/{id,wordCount}.ts       — generateId, normalizeTag, countWords, expectedReadingMs
src/hooks/{useSessionKey,usePersistedSettings,useDataStore}.tsx — the store you consume
.github/workflows/deploy.yml      — GitHub Pages deploy on push to main
```

Every directory has an `index.ts` barrel — import from `../types`, `../crypto`,
`../github`, `../data`, `../hooks`, `../utils` rather than deep-importing files.

## What you consume

### `src/types/index.ts` — build against this first
`Article`, `ArticleTag`, `NewArticleInput`, `ArticleStatus`, `ReadingSession`,
`CompletionResult`, `CompletionInputs`, `UserSettings`, `ReadStackData`, `SyncMeta`,
`EncryptedPayload`. All fields C's completion heuristic needs are already on
`Article`/`ReadingSession` (`scrollDepth`, `measurement: "estimated"|"measured"`,
`activeMs`, `wordCount`, `wordCountIsManual`, `completion`, `status`, `sessions`).
I did **not** implement the completion formula — `CompletionInputs`/`CompletionResult`
are just the shape; `dataReducer`'s `APPLY_COMPLETION` action just writes whatever
result you compute into the article.

### `src/hooks` — the store
- `useDataStore()` — call inside a `<DataStoreProvider>`. Returns
  `{ data, isLoading, syncStatus, syncError, load, dispatch }`.
  - `data: ReadStackData | null` — null until `load()` resolves.
  - `dispatch(action: DataAction)` — applies the reducer, then encrypts+pushes with
    commit message = the article's title (or `"Update settings"` for settings
    changes), per the brief. Returns a promise that resolves after the push; throws
    (and sets `syncError`) if the push fails — local state is still updated, so you
    can retry the push without losing the edit.
  - Action types (see `src/data/reducer.ts`): `ADD_ARTICLE`, `REMOVE_ARTICLE`,
    `UPDATE_TAGS`, `SET_WORD_COUNT`, `START_SESSION`, `UPDATE_SESSION`,
    `APPLY_COMPLETION`, `UPDATE_SETTINGS`. C's tracking hook should dispatch
    `START_SESSION`/`UPDATE_SESSION` as a session progresses and `APPLY_COMPLETION`
    once the formula produces a result.
- `useSessionKey()` — `unlockFresh(passphrase)` (first-time, generates salt) /
  `unlockWithSalt(passphrase, salt, iterations)` (returning user, salt comes from the
  pulled `EncryptedPayload`) / `lock()`. Gives you the `CryptoKey` + `salt` +
  `iterations` that `<DataStoreProvider>` needs.
- `usePersistedSettings()` — plain (non-secret) settings in sessionStorage:
  `githubOwner`, `githubRepo`, `dataFilePath`, `githubBranch`, `readingSpeedWpm`.
  **Does not handle the GitHub PAT** — the brief requires the PAT itself be encrypted
  with the session key. That's on workstream C's Settings screen: encrypt/decrypt it
  directly via `src/crypto` (`encryptWithKey`/`decryptWithKey`) using the same
  `CryptoKey` from `useSessionKey`, store the resulting `EncryptedPayload` in
  sessionStorage yourselves (or wherever your SettingsScreen design puts it) — I
  didn't build a separate PAT-specific hook to avoid guessing your UI's shape.

### `src/crypto`, `src/github`, `src/data` — lower-level, use via hooks normally
Only reach for these directly if you need something the hooks don't expose (e.g. C's
Settings screen encrypting the PAT, as above).

## Integration wiring left for the final pass (App.tsx)
Not done yet — deliberately left for whoever does the integration pass, since it
needs B's UnlockScreen/AppShell and C's SettingsScreen to exist first:
1. Passphrase prompt (B's UnlockScreen) → `useSessionKey().unlockFresh/unlockWithSalt`.
2. Assemble `GitHubFileClientConfig` from `usePersistedSettings()` + PAT (C's
   SettingsScreen) → pass into `<DataStoreProvider>` along with the key/salt/iterations
   from step 1.
3. `useDataStore().load()` once mounted, then render B's `TimeMachineStack` from
   `data.articles`.

## Things B/C should know
- `dispatch` commit-message logic (`commitMessageFor` in `src/data/reducer.ts`) looks
  up the article by `articleId` in current state — for session/completion updates
  this is the *existing* article's title, matching the brief's "for progress updates,
  still use the article's name."
- `ReadingSession.measurement` is always `"estimated"` in v1 (no in-page tracking is
  possible cross-origin per the brief's constraint) — B's card/badge UI should surface
  this (e.g. "~72% estimated" not "72% read") rather than presenting it as exact.
- First-ever run (no `data.json.enc` in the repo yet): `pull()` in `syncEngine.ts`
  catches the 404 and returns `createEmptyReadStackData(defaultSettings)` with
  `sha: null` rather than throwing — the first `dispatch()` will create the file.
- Verified via `npm install` + `npm run build` (`tsc -b && vite build`) — both clean,
  no errors. No test framework wiring beyond `vitest`/`@testing-library` deps being
  present in `package.json`; I didn't author any tests since the brief's completion
  formula (the thing most worth testing) is C's to build.
