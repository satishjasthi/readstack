/**
 * Small pill for rendering a single tag. Purely presentational; used by
 * StackCard, TagInput (article-form), and the tag filter list view.
 */
export interface TagPillProps {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
  onRemove?: (tag: string) => void;
}

export function TagPill({ tag, active = false, onClick, onRemove }: TagPillProps) {
  return (
    <span className={`tag-pill${active ? " tag-pill--active" : ""}`}>
      <button
        type="button"
        className="tag-pill__label"
        onClick={onClick ? () => onClick(tag) : undefined}
        disabled={!onClick}
      >
        #{tag}
      </button>
      {onRemove && (
        <button
          type="button"
          className="tag-pill__remove"
          aria-label={`Remove tag ${tag}`}
          onClick={() => onRemove(tag)}
        >
          ×
        </button>
      )}
    </span>
  );
}
