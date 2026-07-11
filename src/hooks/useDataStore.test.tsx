/**
 * Regression test for the concurrent-dispatch race that caused real 409s
 * ("GitHub updateFileContents failed: 409") when a user added an article
 * and then quickly opened it (which fires its own START_SESSION /
 * SET_WORD_COUNT dispatches) before the first push had resolved.
 *
 * Strategy: mock the GitHub REST layer (`src/github/client`) so `push`/
 * `pull` (src/data/syncEngine) exercise DataStoreProvider's real dispatch
 * queue against a fake remote that enforces the same sha-based optimistic
 * concurrency GitHub does — a stale sha is rejected with a 409 via
 * GitHubApiError, exactly like the real API. This lets us prove the queue
 * fix without hitting the network.
 */
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { DataStoreProvider, useDataStore } from "./useDataStore";
import type { GitHubFileClientConfig } from "../github";
import { encryptWithKey, deriveKey, generateSalt } from "../crypto";
import { DEFAULT_ITERATIONS } from "../crypto";
import type { ReadStackData, UserSettings } from "../types";
import { createEmptyReadStackData } from "../data";

vi.mock("../github/client", async () => {
  const actual = await vi.importActual<typeof import("../github/client")>("../github/client");

  // In-memory fake remote enforcing sha-based optimistic concurrency, same
  // contract as GitHub's real contents API.
  let remoteContent: string | null = null;
  let remoteSha: string | null = null;
  let nextShaCounter = 0;

  function fakeSha() {
    nextShaCounter += 1;
    return `fake-sha-${nextShaCounter}`;
  }

  return {
    ...actual,
    __reset: () => {
      remoteContent = null;
      remoteSha = null;
      nextShaCounter = 0;
    },
    getFileContents: vi.fn(async () => {
      if (remoteContent === null) {
        throw new actual.GitHubFileNotFoundError("data.json.enc");
      }
      return { content: remoteContent, sha: remoteSha! };
    }),
    updateFileContents: vi.fn(
      async (
        _cfg: unknown,
        content: string,
        _commitMessage: string,
        previousSha: string | undefined,
      ) => {
        if (remoteSha !== null && previousSha !== remoteSha) {
          throw new actual.GitHubApiError(
            "GitHub updateFileContents failed: 409 Conflict",
            409,
          );
        }
        remoteContent = content;
        remoteSha = fakeSha();
        return { sha: remoteSha };
      },
    ),
  };
});

const githubClientMock = await import("../github/client");

const TEST_GITHUB_CONFIG: GitHubFileClientConfig = {
  owner: "test-owner",
  repo: "readstack-data",
  path: "data.json.enc",
  branch: "main",
  token: "fake-token",
};

const TEST_SETTINGS: UserSettings = {
  readingSpeedWpm: 200,
  githubOwner: "test-owner",
  githubRepo: "readstack-data",
  dataFilePath: "data.json.enc",
  githubBranch: "main",
};

/** Renders a harness that exposes useDataStore()'s value on `window` for
 * the test to drive directly — simplest way to exercise the real provider
 * + hook without hand-rolling a renderHook shim. */
function Harness({ onReady }: { onReady: (store: ReturnType<typeof useDataStore>) => void }) {
  const store = useDataStore();
  useEffect(() => {
    onReady(store);
  }, [store, onReady]);
  return <div data-testid="status">{store.syncStatus}</div>;
}

describe("DataStoreProvider dispatch queue (409 race regression)", () => {
  beforeEach(() => {
    (githubClientMock as unknown as { __reset: () => void }).__reset();
    vi.clearAllMocks();
  });

  it("serializes concurrent dispatches instead of racing and 409ing", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-passphrase-123", salt, DEFAULT_ITERATIONS);

    let latestStore: ReturnType<typeof useDataStore> | null = null;

    render(
      <DataStoreProvider
        github={TEST_GITHUB_CONFIG}
        sessionKey={key}
        salt={salt}
        iterations={DEFAULT_ITERATIONS}
        defaultSettings={TEST_SETTINGS}
      >
        <Harness onReady={(s) => (latestStore = s)} />
      </DataStoreProvider>,
    );

    await act(async () => {
      await latestStore!.load();
    });

    // Fire two dispatches back-to-back WITHOUT awaiting the first — this is
    // exactly the "add article, then immediately open it" scenario that
    // produced the real 409. Before the fix, both would read the same
    // stale lastKnownSha and race two concurrent pushes.
    let firstError: unknown = null;
    let secondError: unknown = null;

    await act(async () => {
      const p1 = latestStore!
        .dispatch({
          type: "ADD_ARTICLE",
          input: { url: "https://example.com/a", title: "Article A", tags: [] },
        })
        .catch((e) => {
          firstError = e;
        });
      const p2 = latestStore!
        .dispatch({
          type: "ADD_ARTICLE",
          input: { url: "https://example.com/b", title: "Article B", tags: [] },
        })
        .catch((e) => {
          secondError = e;
        });
      await Promise.all([p1, p2]);
    });

    expect(firstError).toBeNull();
    expect(secondError).toBeNull();

    // Both updateFileContents calls happened, but never concurrently with a
    // stale sha rejected — i.e. no 409 surfaced to the caller.
    expect(githubClientMock.updateFileContents).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(latestStore!.data?.articles.map((a) => a.title).sort()).toEqual([
        "Article A",
        "Article B",
      ]);
    });
    expect(latestStore!.syncError).toBeNull();
  });

  it("recovers automatically from a genuine external conflict via retry", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-passphrase-123", salt, DEFAULT_ITERATIONS);

    let latestStore: ReturnType<typeof useDataStore> | null = null;

    render(
      <DataStoreProvider
        github={TEST_GITHUB_CONFIG}
        sessionKey={key}
        salt={salt}
        iterations={DEFAULT_ITERATIONS}
        defaultSettings={TEST_SETTINGS}
      >
        <Harness onReady={(s) => (latestStore = s)} />
      </DataStoreProvider>,
    );

    await act(async () => {
      await latestStore!.load();
    });

    // Simulate a genuinely different writer (another tab/device) pushing a
    // change to the remote AFTER this session's last pull, so this
    // session's lastKnownSha is now stale for reasons outside its own
    // queue (the queue only protects against races within one tab).
    const otherWriterDoc: ReadStackData = {
      ...createEmptyReadStackData(TEST_SETTINGS),
      articles: [
        {
          id: "other-writer-article",
          url: "https://example.com/other",
          title: "From another device",
          tags: [],
          addedAt: Date.now(),
          wordCountIsManual: false,
          status: "unread",
          completion: 0,
          sessions: [],
        },
      ],
    };
    const payload = await encryptWithKey(otherWriterDoc, key, salt, DEFAULT_ITERATIONS);
    // Push directly via the mocked client, bypassing this session's queue,
    // to simulate an out-of-band writer.
    await githubClientMock.updateFileContents(
      TEST_GITHUB_CONFIG,
      JSON.stringify(payload),
      "From another device",
      latestStore!.data!.syncMeta.lastKnownSha ?? undefined,
    );

    // Now this session dispatches, still holding the OLD sha locally — its
    // first push attempt will 409, and it must retry by re-pulling +
    // re-applying rather than surfacing the error.
    let caughtError: unknown = null;
    await act(async () => {
      await latestStore!
        .dispatch({
          type: "ADD_ARTICLE",
          input: { url: "https://example.com/c", title: "Article C", tags: [] },
        })
        .catch((e) => {
          caughtError = e;
        });
    });

    expect(caughtError).toBeNull();
    expect(latestStore!.syncError).toBeNull();

    // The retry re-pulled the other writer's article and merged this
    // session's own addition on top of it — both should be present.
    await waitFor(() => {
      const titles = latestStore!.data?.articles.map((a) => a.title).sort();
      expect(titles).toEqual(["Article C", "From another device"]);
    });
  });
});
