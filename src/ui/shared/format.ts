/**
 * Small formatting helpers shared across workstream B's UI. Presentation-only —
 * no data-model or business logic here (that lives in ../types, ../data, ../utils).
 */

/** Formats a completion ratio (0-1) as a rounded percentage string, e.g. "72%". */
export function formatCompletionPercent(completion: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, completion)) * 100);
  return `${pct}%`;
}

/** Human label for an ArticleStatus, used on badges. */
export function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "in-progress":
      return "In progress";
    case "skimmed":
      return "Skimmed";
    default:
      return "Unread";
  }
}

/** Formats a ms-epoch timestamp as a short date for the timeline rail /
 * card footer, e.g. "Jul 10, 2026". Uses native Intl per the brief's
 * "no date library" constraint. */
export function formatShortDate(msEpoch: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(msEpoch));
}

/** Derives a display hostname from a URL for the card subtitle, falling
 * back to the raw string if it doesn't parse. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
