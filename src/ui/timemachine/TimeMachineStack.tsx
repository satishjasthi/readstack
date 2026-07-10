/**
 * The Time-Machine-style receding stack of article "slices" plus its
 * timeline side rail. Consumes `Article[]` from the shared data model
 * (workstream A) — does not fetch, sync, or mutate data itself; the
 * "open in new tab" click handler is the only side effect owned here.
 */
import { useEffect } from "react";
import type { Article } from "../../types";
import { StackCard } from "./StackCard";
import { TimelineRail } from "./TimelineRail";
import { computeSliceTransform } from "./stackMath";
import { useStackScroll } from "./useStackScroll";

export interface TimeMachineStackProps {
  articles: Article[];
  onOpenArticle: (article: Article) => void;
  onTagClick?: (tag: string) => void;
}

/** Opens the article URL in a new tab. Extracted so it's easy for the
 * integration pass / tests to stub without reimplementing the click
 * handling logic. */
export function openArticleInNewTab(article: Article): void {
  window.open(article.url, "_blank", "noopener,noreferrer");
}

export function TimeMachineStack({ articles, onOpenArticle, onTagClick }: TimeMachineStackProps) {
  const { containerRef, focusIndex, setFocusIndex } = useStackScroll({
    length: articles.length,
  });

  // Keyboard navigation (arrow up/down) as an accessible alternative to
  // wheel/swipe, scoped to when the stack has focus-worthy content.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusIndex(focusIndex + 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIndex(focusIndex - 1);
      }
    };
    const el = containerRef.current;
    el?.addEventListener("keydown", handleKeyDown);
    return () => el?.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, focusIndex, setFocusIndex]);

  if (articles.length === 0) {
    return (
      <div className="time-machine-stack time-machine-stack--empty">
        <p>Your stack is empty. Add an article to get started.</p>
      </div>
    );
  }

  return (
    <div className="time-machine-stack">
      <div
        className="time-machine-stack__scene"
        ref={containerRef as React.RefObject<HTMLDivElement>}
        tabIndex={0}
      >
        {articles.map((article, index) => (
          <StackCard
            key={article.id}
            article={article}
            transform={computeSliceTransform(index, focusIndex)}
            isFocused={index === focusIndex}
            onOpen={onOpenArticle}
            onTagClick={onTagClick}
          />
        ))}
      </div>
      <TimelineRail articles={articles} focusIndex={focusIndex} onSelect={setFocusIndex} />
    </div>
  );
}
