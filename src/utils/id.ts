/** Generates a random id for articles/sessions. Uses crypto.randomUUID when
 * available (all evergreen browsers), falls back to a timestamp+random
 * string otherwise. */
export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalizes a tag: trims whitespace and lowercases for consistent
 * dedupe/filtering. */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}
