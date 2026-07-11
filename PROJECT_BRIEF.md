# ReadStack — Project Brief

## Purpose
A web app for stacking "wanna read" blogs/articles with tags. Data persists as a
single encrypted JSON file synced to a private GitHub repo. UI is inspired by
Apple's Time Machine — stacked card "slices" receding into depth, scroll to move
through a timeline, with a side rail showing the timeline position.

## Repos
- App code (public): https://github.com/satishjasthi/readstack
- Data store (PUBLIC as of 2026-07-11, see decision log below):
  https://github.com/satishjasthi/readstack-data
  - Contains a single encrypted file, e.g. `data.json.enc`

## Confirmed architecture decisions
1. App repo is PUBLIC. Data repo is also PUBLIC (revised 2026-07-11 — see decision
   log below). The JSON is encrypted at rest in the data repo either way;
   encryption, not repo visibility, is the security boundary.
2. Encryption: client-side WebCrypto, AES-GCM, key derived via PBKDF2 from a
   user-entered passphrase each session. Key lives only in memory / sessionStorage,
   never persisted to disk, never leaves the device.
3. GitHub write access: user supplies a fine-grained GitHub Personal Access Token
   (scoped to `readstack-data` repo contents, write access) via a settings screen —
   requested lazily, only the first time a write (add article, progress update) is
   attempted. Reads (pull on load) need NO token at all, since the repo is public.
   Token stored in browser storage (encrypted with the same session
   passphrase-derived key) — never hardcoded, never committed, never sent anywhere
   except GitHub's REST API.
4. Stack: React + Vite + TypeScript, static site, deployed to GitHub Pages from the
   `readstack` repo (hosting is what makes it usable on mobile/iPad via Safari —
   independent of the data repo's visibility).
5. Article content/word-count extraction: best-effort client-side fetch (will hit CORS
   on many sites) with manual override — user can paste/edit estimated word count.
   No server-side proxy in v1.

## Decision log: private → public data repo (2026-07-11)
Originally the data repo was private, requiring a GitHub PAT to even read/probe it
on every device before the app could load. User pushed back: since the file is
encrypted, repo privacy was redundant security theater, and it forced a PAT prompt
before you could even view your own stack on a new device. Resolution:
- Data repo switched to public. `getFileContents`/reads now work fully
  unauthenticated — anyone can technically fetch the ciphertext blob (as intended;
  encryption is the boundary), but cannot decrypt it without the passphrase.
- Writes still require a PAT — this is a hard GitHub platform constraint (no
  anonymous pushes exist, on any repo, public or private), not a design choice. The
  PAT prompt was moved from "required before you can unlock/load anything" to
  "requested lazily on first write attempt," which meaningfully simplifies the
  cross-device read flow.
- Trade-off surfaced to user: since commit message = article name (see below), and
  commit history on a public repo is world-readable, article *titles* and *when
  added* are now technically public even though article *content/tags/notes* stay
  encrypted. User accepted this trade-off explicitly.
- GitHub Pages hosting (for mobile/iPad access via a real URL) is unrelated to this
  decision and was kept — it's how the app is reachable on a device at all, separate
  from how the data syncs.


## Core features
1. Add article: URL + title (auto-fetch if possible) + tags.
2. Sync flow:
   - On app load: pull `data.json.enc` from `readstack-data` via GitHub REST API,
     decrypt with session key, hydrate local state.
   - On every mutation (add article, tag edit, progress update): update in-memory
     state → encrypt → commit+push to `readstack-data`, commit message = article name
     (for progress updates, still use the article's name as commit message).
   - Use GitHub REST API "get contents" (for SHA) + "update file contents" (PUT) —
     no git CLI needed in-browser, pure REST + fetch.
3. Time Machine UI:
   - Cards represent articles, arranged in a receding 3D-ish stack (CSS
     transform: perspective / translateZ / scale, similar to macOS Time Machine).
   - Scrolling (wheel / trackpad, and touch swipe on mobile) moves through the stack;
     side rail shows a timeline (e.g. dates) with current position indicator.
   - Clicking a slice opens the article URL in a new tab AND shows a completion %
     overlay/badge on the card.
4. Smart completion tracking:
   - When article opened in new tab, start a session: capture open timestamp.
   - Track scroll depth AND active dwell time (ignore idle/blurred tab time) via
     `visibilitychange`/`blur`/`focus` and periodic scroll position polling injected
     via a small tracking approach (see constraints below).
   - Estimate word count of the article (best-effort fetch + text extraction, else
     manual entry).
   - Compute expected reading time = word_count / avg_reading_speed (default 200
     wpm, user-configurable).
   - Completion heuristic: combine (a) max scroll depth reached, (b) actual active
     time spent vs expected reading time. E.g. a user who scrolls to 100% in 3 seconds
     on a 2000-word article did NOT read it — flag as "skimmed" not "completed".
     Completion % = min(scrollDepth, timeRatio-adjusted score) — exact formula to be
     defined by implementation subagent, documented in code comments.
   - All this metadata (scroll depth, active time, word count est., computed
     completion %, status: unread/skimmed/in-progress/completed) saved back into the
     JSON and synced to GitHub on update.

## Constraint / known limitation to flag to user
Since articles open in a NEW TAB on an external site (not an iframe — most sites
block iframing), ReadStack's own JS cannot directly observe scroll/dwell time on the
external page. v1 approach: track OPEN duration + tab visibility/focus time in the
ReadStack tab itself as a proxy signal (i.e., measure how long the external tab was
likely active by tracking when focus left/returned to any tab, combined with a
manual "mark as read" / self-reported scroll position fallback), OR ship a tiny
bookmarklet/browser-extension-lite content script as a v2 stretch goal for true
in-page tracking. This must be explicitly surfaced to the user in the UI (e.g. a
tooltip: "estimated" vs "measured") rather than presented as exact.

## Delegation plan
- Planning subagent: turn this brief into a concrete file/module architecture +
  ordered task list.
- Build subagent A: repo scaffold, encryption + GitHub sync layer, data model.
- Build subagent B: Time Machine UI (stack/scroll/timeline rail), article
  add/tag UI.
- Build subagent C: completion-tracking heuristic + settings (PAT entry, passphrase,
  reading speed config).
- QA subagent: install deps, run build, run/author tests, verify end-to-end flow
  with a mocked GitHub API, report issues back.
