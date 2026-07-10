/**
 * A single receding "slice" in the Time Machine stack. Pure presentation:
 * given an Article + a precomputed SliceTransform (see stackMath.ts), it
 * renders the 3D-transformed card. Click opens the article URL in a new
 * tab (per the brief — ReadStack cannot track the external page directly,
 * see CompletionBadge's tooltip for how that's surfaced).
 */
import type { Article } from "../../types";
import { CompletionBadge } from "../shared/CompletionBadge";
import { TagPill } from "../shared/TagPill";
import { formatShortDate, hostnameOf } from "../shared/format";
import { transformToCss, type SliceTransform } from "./stackMath";

export interface StackCardProps {
  article: Article;
  transform: SliceTransform;
  isFocused: boolean;
  onOpen: (article: Article) => void;
  onTagClick?: (tag: string) => void;
}

export function StackCard({ article, transform, isFocused, onOpen, onTagClick }: StackCardProps) {
  const handleActivate = () => {
    if (!transform.isInteractive) return;
    onOpen(article);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleActivate();
    }
  };

  return (
    <div
      className={`stack-card${isFocused ? " stack-card--focused" : ""}`}
      style={{
        transform: transformToCss(transform),
        opacity: transform.opacity,
        zIndex: transform.zIndex,
        pointerEvents: transform.isInteractive ? "auto" : "none",
      }}
      role="button"
      tabIndex={transform.isInteractive ? 0 : -1}
      aria-label={`Open article ${article.title}`}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
    >
      <div className="stack-card__badge">
        <CompletionBadge article={article} />
      </div>
      <h3 className="stack-card__title">{article.title}</h3>
      <div className="stack-card__meta">
        <span className="stack-card__host">{hostnameOf(article.url)}</span>
        <span className="stack-card__date">{formatShortDate(article.addedAt)}</span>
      </div>
      {article.tags.length > 0 && (
        <div className="stack-card__tags">
          {article.tags.map((tag) => (
            <TagPill key={tag} tag={tag} onClick={onTagClick} />
          ))}
        </div>
      )}
    </div>
  );
}
