/**
 * Pure state transitions over ReadStackData. No side effects (no network, no
 * crypto) — syncEngine.ts wraps dispatch with the encrypt+push side effect.
 */

import type {
  Article,
  CompletionResult,
  NewArticleInput,
  ReadingSession,
  ReadStackData,
  UserSettings,
} from "../types";
import { generateId, normalizeTag } from "../utils";

export type DataAction =
  | { type: "ADD_ARTICLE"; input: NewArticleInput }
  | { type: "REMOVE_ARTICLE"; articleId: string }
  | { type: "UPDATE_TAGS"; articleId: string; tags: string[] }
  | { type: "SET_WORD_COUNT"; articleId: string; wordCount: number; isManual: boolean }
  | { type: "START_SESSION"; articleId: string; session: ReadingSession }
  | {
      type: "UPDATE_SESSION";
      articleId: string;
      sessionId: string;
      patch: Partial<Pick<ReadingSession, "activeMs" | "scrollDepth" | "lastUpdatedAt">>;
    }
  | { type: "APPLY_COMPLETION"; articleId: string; result: CompletionResult }
  | { type: "UPDATE_SETTINGS"; patch: Partial<UserSettings> }
  | { type: "SET_SHA"; sha: string | null }
  | { type: "SET_SYNCED_AT"; syncedAt: number };

/** Returns the article name to use as a commit message for a given action,
 * or null if the action doesn't correspond to an article-level mutation that
 * should be synced (e.g. SET_SHA is bookkeeping-only, never triggers a push
 * itself). Used by syncEngine to satisfy "commit message = article name".
 */
export function commitMessageFor(data: ReadStackData, action: DataAction): string | null {
  switch (action.type) {
    case "ADD_ARTICLE":
      return action.input.title;
    case "REMOVE_ARTICLE":
    case "UPDATE_TAGS":
    case "SET_WORD_COUNT":
    case "START_SESSION":
    case "UPDATE_SESSION":
    case "APPLY_COMPLETION": {
      const article = data.articles.find((a) => a.id === action.articleId);
      return article ? article.title : null;
    }
    case "UPDATE_SETTINGS":
      return "Update settings";
    default:
      return null;
  }
}

export function dataReducer(state: ReadStackData, action: DataAction): ReadStackData {
  switch (action.type) {
    case "ADD_ARTICLE": {
      const newArticle: Article = {
        id: generateId(),
        url: action.input.url,
        title: action.input.title,
        tags: action.input.tags.map(normalizeTag),
        addedAt: Date.now(),
        wordCount: action.input.wordCount,
        wordCountIsManual: action.input.wordCountIsManual ?? false,
        status: "unread",
        completion: 0,
        sessions: [],
      };
      return { ...state, articles: [...state.articles, newArticle] };
    }

    case "REMOVE_ARTICLE": {
      return {
        ...state,
        articles: state.articles.filter((a) => a.id !== action.articleId),
      };
    }

    case "UPDATE_TAGS": {
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.articleId ? { ...a, tags: action.tags.map(normalizeTag) } : a,
        ),
      };
    }

    case "SET_WORD_COUNT": {
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.articleId
            ? { ...a, wordCount: action.wordCount, wordCountIsManual: action.isManual }
            : a,
        ),
      };
    }

    case "START_SESSION": {
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.articleId ? { ...a, sessions: [...a.sessions, action.session] } : a,
        ),
      };
    }

    case "UPDATE_SESSION": {
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.articleId
            ? {
                ...a,
                sessions: a.sessions.map((s) =>
                  s.id === action.sessionId ? { ...s, ...action.patch } : s,
                ),
              }
            : a,
        ),
      };
    }

    case "APPLY_COMPLETION": {
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.articleId
            ? { ...a, completion: action.result.completion, status: action.result.status }
            : a,
        ),
      };
    }

    case "UPDATE_SETTINGS": {
      return { ...state, settings: { ...state.settings, ...action.patch } };
    }

    case "SET_SHA": {
      return { ...state, syncMeta: { ...state.syncMeta, lastKnownSha: action.sha } };
    }

    case "SET_SYNCED_AT": {
      return { ...state, syncMeta: { ...state.syncMeta, lastSyncedAt: action.syncedAt } };
    }

    default:
      return state;
  }
}

/** Default/empty document for first-time setup (no data file in the repo
 * yet). */
export function createEmptyReadStackData(settings: UserSettings): ReadStackData {
  return {
    version: 1,
    articles: [],
    settings,
    syncMeta: { lastKnownSha: null, lastSyncedAt: null },
  };
}
