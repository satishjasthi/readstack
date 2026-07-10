/**
 * Free-form tag entry: type + Enter/comma to add, click × to remove.
 * Presentation + local-only input state; the caller owns the committed
 * tag list (no data-model writes happen here).
 */
import { useState } from "react";
import { TagPill } from "../shared/TagPill";

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ tags, onChange, placeholder = "Add a tag…" }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const normalized = draft.trim().toLowerCase();
    if (normalized.length === 0) return;
    if (!tags.includes(normalized)) {
      onChange([...tags, normalized]);
    }
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className="tag-input">
      <div className="tag-input__pills">
        {tags.map((tag) => (
          <TagPill key={tag} tag={tag} onRemove={removeTag} />
        ))}
      </div>
      <input
        type="text"
        className="tag-input__field"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        aria-label="Add tag"
      />
    </div>
  );
}
