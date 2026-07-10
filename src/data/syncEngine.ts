/**
 * Orchestrates the sync flow described in the brief:
 *  - On load: pull data.json.enc, decrypt with session key, hydrate state.
 *  - On every mutation: encrypt updated state, push with commit message =
 *    article name.
 *
 * No React here — this is a plain async class so it's independently
 * testable and so hooks/useDataStore.ts can be a thin adapter.
 */

import { decryptWithKey, encryptWithKey, generateSalt } from "../crypto";
import {
  GitHubFileNotFoundError,
  getFileContents,
  updateFileContents,
  type GitHubFileClientConfig,
} from "../github";
import type { EncryptedPayload, ReadStackData, UserSettings } from "../types";
import { createEmptyReadStackData } from "./reducer";

export interface SyncEngineConfig {
  github: GitHubFileClientConfig;
  /** Derived AES-GCM key for this session (see hooks/useSessionKey.ts). */
  key: CryptoKey;
  /** Salt used to derive `key` — must be carried through into every
   * encrypted payload so decryption works next session. */
  salt: Uint8Array;
  iterations: number;
}

export interface PullResult {
  data: ReadStackData;
  sha: string | null;
}

/**
 * Pulls and decrypts the data file. If the file doesn't exist yet (fresh
 * repo), returns a freshly-initialized empty document with `sha: null`
 * rather than throwing — the first push will create the file.
 */
export async function pull(
  cfg: SyncEngineConfig,
  defaultSettings: UserSettings,
): Promise<PullResult> {
  try {
    const { content, sha } = await getFileContents(cfg.github);
    const payload = JSON.parse(content) as EncryptedPayload;
    const data = await decryptWithKey<ReadStackData>(payload, cfg.key);
    return { data, sha };
  } catch (err) {
    if (err instanceof GitHubFileNotFoundError) {
      return { data: createEmptyReadStackData(defaultSettings), sha: null };
    }
    throw err;
  }
}

export interface PushResult {
  sha: string;
}

/**
 * Encrypts `data` and pushes it to the data repo, using `commitMessage` as
 * the commit message (per the brief: the article name, for both new
 * articles and progress updates).
 *
 * `previousSha` should be the sha from the last pull/push (ReadStackData's
 * own syncMeta.lastKnownSha), or null for the first-ever push.
 */
export async function push(
  cfg: SyncEngineConfig,
  data: ReadStackData,
  commitMessage: string,
  previousSha: string | null,
): Promise<PushResult> {
  const payload = await encryptWithKey(data, cfg.key, cfg.salt, cfg.iterations);
  const result = await updateFileContents(
    cfg.github,
    JSON.stringify(payload),
    commitMessage,
    previousSha ?? undefined,
  );
  return { sha: result.sha };
}

/** Generates a fresh salt for brand-new (first-ever) data files. Existing
 * files carry their salt inside the EncryptedPayload itself. */
export { generateSalt };
