/**
 * Top-level layout shell for the authenticated/unlocked app: header + view
 * switcher (Time Machine stack vs tag list) + the add-article form.
 *
 * This component is deliberately data-agnostic about sync/crypto — it
 * receives `articles` and callbacks as props rather than calling
 * useDataStore()/useSessionKey() itself, so the integration pass (App.tsx)
 * decides how those are wired (passphrase unlock, PAT, GitHub config are
 * out of workstream B's scope per the brief's delegation plan).
 */
import { useState } from "react";
import type { Article, NewArticleInput } from "../../types";
import { AddArticleForm, TagFilterList } from "../article-form";
import { TimeMachineStack, openArticleInNewTab } from "../timemachine";

export type StackView = "stack" | "list";

export interface AppShellProps {
  articles: Article[];
  onAddArticle: (input: NewArticleInput) => void;
  isSubmitting?: boolean;
  /** Sync status surfaced from useDataStore(), for a small header indicator.
   * Optional so this component is usable/testable without a live store. */
  syncStatus?: "idle" | "syncing" | "error";
  syncError?: string | null;
  /** Override for how a clicked/opened article slice is handled. Defaults
   * to a plain `window.open` (openArticleInNewTab) so this component stays
   * usable/testable standalone; the integration layer passes
   * `useReadingSession().openArticle` here so opening a card also starts
   * completion tracking (see App.tsx). */
  onOpenArticle?: (article: Article) => void;
}

export function AppShell({
  articles,
  onAddArticle,
  isSubmitting = false,
  syncStatus = "idle",
  syncError = null,
  onOpenArticle,
}: AppShellProps) {
  const [view, setView] = useState<StackView>("stack");
  const [showForm, setShowForm] = useState(false);

  const handleOpenArticle = (article: Article) => {
    if (onOpenArticle) {
      onOpenArticle(article);
    } else {
      openArticleInNewTab(article);
    }
  };

  const handleAddArticle = (input: NewArticleInput) => {
    onAddArticle(input);
    setShowForm(false);
  };

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <h1 className="app-shell__title">ReadStack</h1>
        <div className="app-shell__view-switch" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={view === "stack"}
            className={view === "stack" ? "is-active" : ""}
            onClick={() => setView("stack")}
          >
            Stack
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
          >
            Tags &amp; list
          </button>
        </div>
        <button
          type="button"
          className="app-shell__add-toggle"
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
        >
          {showForm ? "Close" : "+ Add article"}
        </button>
        {syncStatus !== "idle" && (
          <span className={`app-shell__sync-status app-shell__sync-status--${syncStatus}`}>
            {syncStatus === "syncing" ? "Syncing…" : `Sync error${syncError ? `: ${syncError}` : ""}`}
          </span>
        )}
      </header>

      {showForm && (
        <div className="app-shell__form-panel">
          <AddArticleForm onSubmit={handleAddArticle} isSubmitting={isSubmitting} />
        </div>
      )}

      <main className="app-shell__main">
        {view === "stack" ? (
          <TimeMachineStack articles={articles} onOpenArticle={handleOpenArticle} />
        ) : (
          <TagFilterList articles={articles} onOpenArticle={handleOpenArticle} />
        )}
      </main>
    </div>
  );
}
