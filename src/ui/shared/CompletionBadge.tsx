/**
 * Small badge showing an article's completion % + status. Presentation-only —
 * consumes `Article.completion` / `Article.status` from the shared data
 * model (workstream A). Does not compute completion itself (that's
 * workstream C's heuristic, via APPLY_COMPLETION).
 */
import type { Article } from "../../types";
import { formatCompletionPercent, statusLabel } from "./format";

export interface CompletionBadgeProps {
  article: Article;
  /** Compact renders just the %, full renders % + status label. */
  variant?: "compact" | "full";
}

/** True if any session on the article used self-reported/estimated
 * tracking rather than in-page measurement — per the brief, this must be
 * surfaced to the user rather than presented as exact. */
function isEstimated(article: Article): boolean {
  if (article.sessions.length === 0) return true;
  return article.sessions.some((s) => s.measurement === "estimated");
}

export function CompletionBadge({ article, variant = "compact" }: CompletionBadgeProps) {
  const pct = formatCompletionPercent(article.completion);
  const estimated = isEstimated(article);
  const title = estimated
    ? "Completion is estimated from open duration and self-reported scroll position — ReadStack cannot measure activity on the external page directly."
    : "Measured completion.";

  return (
    <span
      className={`completion-badge completion-badge--${article.status}`}
      title={title}
      aria-label={`${statusLabel(article.status)}, ${pct}${estimated ? " estimated" : ""}`}
    >
      <span className="completion-badge__pct">{estimated ? `~${pct}` : pct}</span>
      {variant === "full" && (
        <span className="completion-badge__label">{statusLabel(article.status)}</span>
      )}
    </span>
  );
}
