/**
 * Shared data model for ReadStack.
 *
 * Ownership: workstream A (this file). Workstreams B and C build and unit-test
 * against these interfaces without waiting on the crypto/sync implementation.
 *
 * Do not add UI-only or tracking-heuristic-only fields here unless they need to be
 * persisted in the synced JSON — this is the persisted-data contract, not a
 * scratch/derived-state type.
 */

/** Lifecycle status of an article in the stack. Computed by workstream C's
 * completion heuristic and persisted alongside the article. */
export type ArticleStatus = "unread" | "in-progress" | "skimmed" | "completed";

/** A user-defined tag attached to an article. Free-form string, normalized
 * (lowercased, trimmed) by the caller before storage. */
export type ArticleTag = string;

/**
 * A single tracked reading session for an article — one per "open in new tab"
 * event. Multiple sessions can exist per article (e.g. reopened later); the
 * completion heuristic (workstream C) decides how to combine them.
 *
 * Per the brief's known limitation: ReadStack cannot observe scroll/dwell on the
 * external page directly (cross-origin, no iframe). `scrollDepth` in v1 is
 * self-reported/estimated via a proxy signal, not measured in-page. `measurement`
 * records which it was so the UI (workstream B) can show "estimated" vs "measured"
 * rather than presenting it as exact, per the brief's explicit requirement.
 */
export interface ReadingSession {
  id: string;
  articleId: string;
  /** ms since epoch when the article was opened in a new tab. */
  openedAt: number;
  /** ms since epoch when this session was last updated/closed. */
  lastUpdatedAt: number;
  /** Cumulative active (non-idle, tab-focused) time in this session, ms. */
  activeMs: number;
  /** Max scroll depth reached, 0-1. Self-reported/estimated in v1. */
  scrollDepth: number;
  /** How scrollDepth/activity was obtained. v1 only ever produces "estimated";
   * "measured" is reserved for the v2 bookmarklet/extension stretch goal. */
  measurement: "estimated" | "measured";
}

/** Inputs to the completion % heuristic (workstream C owns the formula; A owns
 * the shape so C can build against it immediately). */
export interface CompletionInputs {
  /** Max scroll depth across all sessions for the article, 0-1. */
  scrollDepth: number;
  /** Cumulative active time across all sessions, ms. */
  activeMs: number;
  /** word_count / (readingSpeedWpm / 60000) — precomputed by caller. */
  expectedMs: number;
}

/** Output of the completion % heuristic. */
export interface CompletionResult {
  /** 0-1 */
  completion: number;
  status: ArticleStatus;
}

/** An article in the reading stack. This is the persisted shape stored in the
 * encrypted JSON's `articles` array. */
export interface Article {
  id: string;
  url: string;
  title: string;
  tags: ArticleTag[];
  /** ms since epoch when the article was added to the stack. Drives the
   * Time-Machine timeline ordering. */
  addedAt: number;
  /** Best-effort fetched or manually-entered word count. Undefined until known. */
  wordCount?: number;
  /** True if wordCount came from a manual override rather than auto-fetch. */
  wordCountIsManual: boolean;
  status: ArticleStatus;
  /** 0-1, most recent computed completion value (see CompletionResult). */
  completion: number;
  /** All reading sessions recorded for this article, oldest first. */
  sessions: ReadingSession[];
}

/** Payload shape for adding a new article, before ids/defaults are assigned. */
export interface NewArticleInput {
  url: string;
  title: string;
  tags: ArticleTag[];
  wordCount?: number;
  wordCountIsManual?: boolean;
}

/** User-configurable settings, persisted (encrypted) alongside article data. */
export interface UserSettings {
  /** Average reading speed in words per minute, used to compute expectedMs. */
  readingSpeedWpm: number;
  /** GitHub owner/org that owns the readstack-data repo. */
  githubOwner: string;
  /** Name of the private data repo, e.g. "readstack-data". */
  githubRepo: string;
  /** Path to the encrypted data file within the data repo. */
  dataFilePath: string;
  /** Branch to read/write, e.g. "main". */
  githubBranch: string;
}

/** Bookkeeping about the last sync, kept alongside the data but not sent to the
 * completion heuristic. */
export interface SyncMeta {
  /** git blob SHA of the last-loaded/pushed file content, used for the GitHub
   * "update file contents" API's required `sha` param (optimistic concurrency). */
  lastKnownSha: string | null;
  /** ms since epoch of the last successful sync (pull or push). */
  lastSyncedAt: number | null;
}

/**
 * The full decrypted document persisted as JSON, encrypted, and synced to
 * `readstack-data`. This is the root object the reducer (`data/reducer.ts`)
 * operates on.
 */
export interface ReadStackData {
  /** Schema version for forward-compatible migrations. */
  version: 1;
  articles: Article[];
  settings: UserSettings;
  syncMeta: SyncMeta;
}

/**
 * Wire format actually written to `data.json.enc`. AES-GCM ciphertext plus the
 * parameters needed to re-derive the key and decrypt — everything except the
 * user's passphrase itself.
 */
export interface EncryptedPayload {
  /** Format/version marker for forward compatibility. */
  version: 1;
  /** Base64-encoded PBKDF2 salt. */
  salt: string;
  /** Base64-encoded AES-GCM IV/nonce. */
  iv: string;
  /** Base64-encoded ciphertext (includes GCM auth tag). */
  ciphertext: string;
  /** PBKDF2 iteration count used, so it can change over time without breaking
   * old files. */
  iterations: number;
}
