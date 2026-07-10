/**
 * "Add article" form: URL, title, tags. Produces a NewArticleInput (shared
 * type from workstream A) and hands it to the caller's onSubmit — this
 * component does not dispatch to the store itself, keeping it testable in
 * isolation and letting the integration pass decide how ADD_ARTICLE is
 * dispatched (e.g. via useDataStore().dispatch).
 *
 * Per the brief, title auto-fetch from the URL is best-effort/CORS-limited;
 * v1 here just requires the user to type a title (auto-fetch is a
 * reasonable follow-up, not blocking this form's contract).
 */
import { useState } from "react";
import type { NewArticleInput } from "../../types";
import { TagInput } from "./TagInput";

export interface AddArticleFormProps {
  onSubmit: (input: NewArticleInput) => void;
  /** Disables the submit button while a dispatch/push is in flight. */
  isSubmitting?: boolean;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function AddArticleForm({ onSubmit, isSubmitting = false }: AddArticleFormProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedUrl = url.trim();
    const trimmedTitle = title.trim();

    if (!isValidUrl(trimmedUrl)) {
      setError("Enter a valid http(s) URL.");
      return;
    }
    if (trimmedTitle.length === 0) {
      setError("Title is required.");
      return;
    }

    setError(null);
    onSubmit({ url: trimmedUrl, title: trimmedTitle, tags });
    setUrl("");
    setTitle("");
    setTags([]);
  };

  return (
    <form className="add-article-form" onSubmit={handleSubmit}>
      <h2 className="add-article-form__heading">Add article</h2>

      <label className="add-article-form__field">
        <span>URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/great-article"
          required
        />
      </label>

      <label className="add-article-form__field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Article title"
          required
        />
      </label>

      <label className="add-article-form__field">
        <span>Tags</span>
        <TagInput tags={tags} onChange={setTags} />
      </label>

      {error && (
        <p className="add-article-form__error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Adding…" : "Add to stack"}
      </button>
    </form>
  );
}
