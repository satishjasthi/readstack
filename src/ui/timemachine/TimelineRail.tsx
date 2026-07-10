/**
 * Side rail showing chronological position through the stack, with a
 * current-position indicator — the Time Machine "date ruler" analog.
 * Purely derived from the article list's `addedAt` field + focusIndex;
 * clicking a tick jumps the stack to that article.
 */
import type { Article } from "../../types";
import { formatShortDate } from "../shared/format";
import { focusToRailFraction } from "./stackMath";

export interface TimelineRailProps {
  articles: Article[];
  focusIndex: number;
  onSelect: (index: number) => void;
}

export function TimelineRail({ articles, focusIndex, onSelect }: TimelineRailProps) {
  const fraction = focusToRailFraction(focusIndex, articles.length);

  return (
    <nav className="timeline-rail" aria-label="Reading stack timeline">
      <div className="timeline-rail__track">
        <div
          className="timeline-rail__indicator"
          style={{ top: `${fraction * 100}%` }}
          aria-hidden="true"
        />
        <ol className="timeline-rail__ticks">
          {articles.map((article, index) => (
            <li key={article.id} className="timeline-rail__tick-item">
              <button
                type="button"
                className={`timeline-rail__tick${index === focusIndex ? " timeline-rail__tick--active" : ""}`}
                onClick={() => onSelect(index)}
                aria-current={index === focusIndex}
                title={article.title}
              >
                <span className="timeline-rail__tick-date">{formatShortDate(article.addedAt)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
