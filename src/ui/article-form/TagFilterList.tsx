/**
 * Tag filter + flat list view — an alternative to the 3D stack for
 * scanning/filtering by tag. Purely derives the tag universe and filtered
 * article list from `Article[]`; selection state is local unless the
 * caller wants to lift it (kept internal here since only this view needs
 * it, per the plan's ownership split).
 */
import { useMemo, useState } from "react";
import type { Article } from "../../types";
import { CompletionBadge, TagPill } from "../shared";
import { formatShortDate, hostnameOf } from "../shared/format";

export interface TagFilterListProps {
  articles: Article[];
  onOpenArticle: (article: Article) => void;
}

function collectTags(articles: Article[]): string[] {
  const set = new Set<string>();
  for (const article of articles) {
    for (const tag of article.tags) set.add(tag);
  }
  return [...set].sort();
}

export function TagFilterList({ articles, onOpenArticle }: TagFilterListProps) {
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const allTags = useMemo(() => collectTags(articles), [articles]);

  const filtered = useMemo(() => {
    if (activeTags.length === 0) return articles;
    return articles.filter((a) => activeTags.every((tag) => a.tags.includes(tag)));
  }, [articles, activeTags]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className="tag-filter-list">
      <div className="tag-filter-list__filters" role="group" aria-label="Filter by tag">
        {allTags.length === 0 && <p className="tag-filter-list__empty-tags">No tags yet.</p>}
        {allTags.map((tag) => (
          <TagPill key={tag} tag={tag} active={activeTags.includes(tag)} onClick={toggleTag} />
        ))}
        {activeTags.length > 0 && (
          <button type="button" className="tag-filter-list__clear" onClick={() => setActiveTags([])}>
            Clear filters
          </button>
        )}
      </div>

      <ul className="tag-filter-list__items">
        {filtered.map((article) => (
          <li key={article.id} className="tag-filter-list__item">
            <button
              type="button"
              className="tag-filter-list__item-open"
              onClick={() => onOpenArticle(article)}
            >
              <span className="tag-filter-list__item-title">{article.title}</span>
              <span className="tag-filter-list__item-meta">
                {hostnameOf(article.url)} · {formatShortDate(article.addedAt)}
              </span>
            </button>
            <CompletionBadge article={article} variant="full" />
            <div className="tag-filter-list__item-tags">
              {article.tags.map((tag) => (
                <TagPill key={tag} tag={tag} onClick={toggleTag} active={activeTags.includes(tag)} />
              ))}
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="tag-filter-list__empty">No articles match the selected tags.</li>
        )}
      </ul>
    </div>
  );
}
