/**
 * Best-effort word-count estimation for an article URL.
 *
 * Per the brief: "Article content/word-count extraction: best-effort
 * client-side fetch (will hit CORS on many sites) with manual override —
 * user can paste/edit estimated word count. No server-side proxy in v1."
 *
 * This module only ever ATTEMPTS a same-origin-permitting fetch. Most
 * article sites do not send permissive CORS headers, so failure is the
 * common case, not an edge case — callers must always have the manual
 * entry field as the real fallback path, not just an error-recovery UI.
 */

import { countWords } from "../utils";

export interface WordCountEstimateResult {
  /** Present only if the fetch + extraction succeeded. */
  wordCount?: number;
  /** True if the fetch failed (CORS, network, non-OK status, etc.) — the
   * caller should fall back to prompting for manual entry. */
  failed: boolean;
  /** Human-readable reason, useful for a UI hint ("couldn't fetch — CORS
   * blocked or offline") without needing to inspect the raw error. */
  reason?: string;
}

/** Strips HTML tags and collapses whitespace to approximate visible text.
 * Deliberately simple (regex-based, no DOM parser dependency) — this is a
 * best-effort estimate, not a faithful content extraction; script/style
 * bodies are stripped first since their contents aren't visible text. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Attempts to fetch `url` and estimate its word count from stripped HTML
 * text. Resolves (never rejects) with `{ failed: true, reason }` on any
 * failure — network error, non-2xx response, or (most commonly) a CORS
 * rejection that fetch surfaces as an opaque `TypeError`.
 */
export async function estimateWordCount(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WordCountEstimateResult> {
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      return {
        failed: true,
        reason: `Fetch failed with status ${response.status}. Enter word count manually.`,
      };
    }
    const html = await response.text();
    const text = stripHtmlToText(html);
    const wordCount = countWords(text);
    if (wordCount === 0) {
      return {
        failed: true,
        reason: "Fetched page had no extractable text. Enter word count manually.",
      };
    }
    return { wordCount, failed: false };
  } catch (err) {
    // Cross-origin fetches to sites without permissive CORS headers throw
    // here (browsers surface this as an opaque TypeError with no useful
    // detail) — this is the expected common case per the brief, not a bug.
    const message = err instanceof Error ? err.message : String(err);
    return {
      failed: true,
      reason: `Could not fetch article (likely blocked by CORS): ${message}. Enter word count manually.`,
    };
  }
}
