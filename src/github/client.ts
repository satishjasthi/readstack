/**
 * GitHub REST API client for reading/writing the encrypted data file in the
 * private `readstack-data` repo. Pure REST + fetch — no git CLI, no octokit
 * dependency (keeps the dependency list minimal per the brief).
 *
 * Docs: https://docs.github.com/en/rest/repos/contents
 */

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubFileClientConfig {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  /** Fine-grained PAT scoped to this repo's contents (read+write). Never
   * logged, never sent anywhere but api.github.com. */
  token: string;
}

export interface GitHubFileContents {
  /** Raw file content (already base64-decoded, UTF-8 decoded). */
  content: string;
  /** git blob SHA — required by the "update file contents" API call to avoid
   * clobbering concurrent edits. */
  sha: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

/** Thrown by getFileContents when the file doesn't exist yet (404) — callers
 * use this to distinguish "no data file yet, initialize one" from a real
 * failure. */
export class GitHubFileNotFoundError extends GitHubApiError {
  constructor(path: string) {
    super(`File not found: ${path}`, 404);
    this.name = "GitHubFileNotFoundError";
  }
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(cfg: Pick<GitHubFileClientConfig, "owner" | "repo" | "path">): string {
  return `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
}

/** UTF-8 safe base64 encode/decode (browser atob/btoa are Latin1-only). */
function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64DecodeUtf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Fetches the current file contents + git blob SHA from the data repo.
 * Throws GitHubFileNotFoundError if the file doesn't exist yet.
 */
export async function getFileContents(
  cfg: GitHubFileClientConfig,
): Promise<GitHubFileContents> {
  const url = `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`;
  const response = await fetch(url, { headers: authHeaders(cfg.token) });

  if (response.status === 404) {
    throw new GitHubFileNotFoundError(cfg.path);
  }
  if (!response.ok) {
    throw new GitHubApiError(
      `GitHub getFileContents failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const body = (await response.json()) as { content: string; sha: string; encoding: string };
  if (body.encoding !== "base64") {
    throw new GitHubApiError(`Unexpected encoding from GitHub: ${body.encoding}`, response.status);
  }

  return { content: base64DecodeUtf8(body.content), sha: body.sha };
}

export interface UpdateFileContentsResult {
  /** New git blob SHA after the update, to be stored for the next update's
   * optimistic-concurrency check. */
  sha: string;
}

/**
 * Creates or updates the data file in the private repo.
 *
 * `commitMessage` should be the article name being added/updated, per the
 * brief ("commit message = article name" — for progress updates, still use
 * the article's name).
 *
 * `previousSha` must be the SHA last read via getFileContents (or undefined
 * if the file doesn't exist yet, i.e. first-ever push). GitHub rejects the
 * write with a 409/422 if it's stale, which the caller should treat as "pull
 * latest and retry" rather than blindly overwriting.
 */
export async function updateFileContents(
  cfg: GitHubFileClientConfig,
  content: string,
  commitMessage: string,
  previousSha: string | undefined,
): Promise<UpdateFileContentsResult> {
  const response = await fetch(contentsUrl(cfg), {
    method: "PUT",
    headers: {
      ...authHeaders(cfg.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: commitMessage,
      content: base64EncodeUtf8(content),
      branch: cfg.branch,
      ...(previousSha ? { sha: previousSha } : {}),
    }),
  });

  if (!response.ok) {
    throw new GitHubApiError(
      `GitHub updateFileContents failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const body = (await response.json()) as { content: { sha: string } };
  return { sha: body.content.sha };
}
