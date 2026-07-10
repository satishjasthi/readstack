/**
 * Best-effort word count utility. The actual fetch+extraction heuristic and
 * any DOM/text-density scoring is workstream C's responsibility (it's part
 * of the completion-tracking feature). This module only provides the plain
 * "count words in a string" primitive, useful for manual-entry validation
 * and for C to build on.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Computes expected reading time in ms from word count and reading speed. */
export function expectedReadingMs(wordCount: number, readingSpeedWpm: number): number {
  if (readingSpeedWpm <= 0) return 0;
  return (wordCount / readingSpeedWpm) * 60_000;
}
