/**
 * Integration pass: wires workstream A's store/crypto/sync, workstream B's
 * UI (UnlockScreen/AppShell/TimeMachineStack), and workstream C's
 * SettingsScreen/useReadingSession together.
 *
 * Flow (simplified: `readstack-data` is a PUBLIC repo, since the file
 * itself is encrypted — repo visibility isn't the security boundary):
 *  1. Once a GitHub owner is set, probe the data repo directly via
 *     `getFileContents` — no token needed, reads on a public repo are
 *     anonymous — to decide first-run (404 -> unlockFresh) vs returning
 *     user (existing salt -> unlockWithSalt).
 *  2. Render UnlockScreen (B) with the right mode; on submit, derive the
 *     session key via useSessionKey (A). No PAT involved yet.
 *  3. Mount <DataStoreProvider> (A) and call load() — still no token
 *     needed, this is a read. Render AppShell (B) with your stack.
 *  4. A GitHub PAT is only requested the first time the user performs a
 *     WRITE (add an article, update progress, etc.) — via PatBootstrap,
 *     rendered inline only when a write is attempted without one on file.
 *     GitHub never allows unauthenticated pushes, even to a public repo,
 *     so this part is unavoidable — but it no longer blocks reading/
 *     browsing your existing stack on a new device.
 *  5. AppShell's onOpenArticle is wired to useReadingSession().openArticle
 *     (C) rather than TimeMachineStack's bare openArticleInNewTab, so
 *     opening a card also starts real completion tracking.
 */

import { useCallback, useEffect, useState } from "react";
import { AppShell, UnlockScreen } from "./ui/layout";
import { SettingsScreen } from "./settings";
import { useReadingSession } from "./tracking";
import {
  DataStoreProvider,
  useDataStore,
  usePersistedSettings,
  useSessionKey,
} from "./hooks";
import { getFileContents, GitHubFileNotFoundError, type GitHubFileClientConfig } from "./github";
import type { EncryptedPayload, NewArticleInput } from "./types";

type RepoProbeState =
  | { status: "unknown" }
  | { status: "checking" }
  | { status: "first-run" }
  | { status: "returning"; salt: Uint8Array; iterations: number }
  | { status: "error"; message: string };

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Pre-unlock phase: probe the (public, unauthenticated-readable) data repo
 * to decide first-run vs returning-user, then collect the passphrase via
 * UnlockScreen. Resolves once a CryptoKey is derived. No PAT involved.
 */
function UnlockFlow({
  githubConfig,
  onUnlocked,
}: {
  githubConfig: GitHubFileClientConfig | null;
  onUnlocked: (key: CryptoKey, salt: Uint8Array, iterations: number) => void;
}) {
  const sessionKeyState = useSessionKey();
  const [probe, setProbe] = useState<RepoProbeState>({ status: "unknown" });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  useEffect(() => {
    if (!githubConfig) return;
    let cancelled = false;
    setProbe({ status: "checking" });

    async function probeRepo() {
      try {
        const { content } = await getFileContents(githubConfig!);
        const payload = JSON.parse(content) as EncryptedPayload;
        if (!cancelled) {
          setProbe({
            status: "returning",
            salt: base64ToBytes(payload.salt),
            iterations: payload.iterations,
          });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof GitHubFileNotFoundError) {
          setProbe({ status: "first-run" });
        } else {
          setProbe({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    void probeRepo();
    return () => {
      cancelled = true;
    };
  }, [githubConfig]);

  const handleUnlock = useCallback(
    async (passphrase: string) => {
      setUnlockError(null);
      setIsUnlocking(true);
      try {
        if (probe.status === "returning") {
          const key = await sessionKeyState.unlockWithSalt(passphrase, probe.salt, probe.iterations);
          onUnlocked(key, probe.salt, probe.iterations);
        } else {
          const key = await sessionKeyState.unlockFresh(passphrase);
          const state = sessionKeyState;
          // salt/iterations were just generated inside unlockFresh; read
          // them back off the hook's own state on the next tick isn't
          // available synchronously, so unlockFresh's return value (the
          // key) is paired with state we derive here instead.
          onUnlocked(key, state.salt ?? new Uint8Array(), state.iterations);
        }
      } catch (err) {
        setUnlockError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsUnlocking(false);
      }
    },
    [probe, sessionKeyState, onUnlocked],
  );

  if (!githubConfig) {
    return (
      <div className="unlock-screen">
        <p className="unlock-screen__subtitle">
          Enter a GitHub owner/org below (in Settings) to locate your reading stack.
        </p>
      </div>
    );
  }

  if (probe.status === "unknown" || probe.status === "checking") {
    return (
      <div className="unlock-screen">
        <p className="unlock-screen__subtitle">Checking readstack-data…</p>
      </div>
    );
  }

  if (probe.status === "error") {
    return (
      <div className="unlock-screen">
        <p className="unlock-screen__error" role="alert">
          Could not reach readstack-data: {probe.message}
        </p>
      </div>
    );
  }

  return (
    <UnlockScreen
      isFirstRun={probe.status === "first-run"}
      onUnlock={handleUnlock}
      isUnlocking={isUnlocking}
      error={unlockError}
    />
  );
}

/** Mounted once a CryptoKey + GitHub config are available. Loads the store
 * (read-only, no PAT needed against the public data repo) and renders the
 * real app (AppShell). A PAT is only requested lazily, the first time a
 * write is attempted (see `PatGate`). */
function UnlockedApp({
  pat,
  onRequestPat,
}: {
  pat: string | null;
  onRequestPat: (pat: string) => void;
}) {
  const { data, isLoading, syncStatus, syncError, load, dispatch } = useDataStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingPatPrompt, setPendingPatPrompt] = useState(false);
  const readingSession = useReadingSession({
    readingSpeedWpm: data?.settings.readingSpeedWpm ?? 200,
  });

  useEffect(() => {
    void load();
    // Runs once on mount for this session; `load` is stable per syncCfg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddArticle = useCallback(
    async (input: NewArticleInput) => {
      if (!pat) {
        // First write of the session: we can't push without a token (GitHub
        // never allows unauthenticated writes, even on a public repo).
        // Surface the PAT prompt instead of silently failing.
        setPendingPatPrompt(true);
        return;
      }
      setIsSubmitting(true);
      try {
        await dispatch({ type: "ADD_ARTICLE", input });
      } finally {
        setIsSubmitting(false);
      }
    },
    [dispatch, pat],
  );

  if (isLoading || !data) {
    return (
      <div className="unlock-screen">
        <p className="unlock-screen__subtitle">
          {syncError ? `Failed to load: ${syncError}` : "Loading your stack…"}
        </p>
      </div>
    );
  }

  return (
    <>
      {pendingPatPrompt && !pat && (
        <div className="settings-field" data-testid="pat-write-gate">
          <label htmlFor="pat-write-gate-input">GitHub token (needed to save)</label>
          <p className="settings-field-hint">
            Reading your stack never needs a token — <code>readstack-data</code> is
            public and the file is encrypted. Saving a change requires one, since
            GitHub only allows authenticated pushes.
          </p>
          <PatBootstrap
            onPat={(value) => {
              onRequestPat(value);
              setPendingPatPrompt(false);
            }}
          />
        </div>
      )}
      <AppShell
        articles={data.articles}
        onAddArticle={handleAddArticle}
        isSubmitting={isSubmitting}
        syncStatus={syncStatus}
        syncError={syncError}
        onOpenArticle={readingSession.openArticle}
      />
    </>
  );
}

function App() {
  const { settings, updateSettings } = usePersistedSettings();
  const [pat, setPat] = useState<string | null>(null);
  const [unlockedKey, setUnlockedKey] = useState<CryptoKey | null>(null);
  const [salt, setSalt] = useState<Uint8Array | null>(null);
  const [iterations, setIterations] = useState<number>(0);

  // Reads (probe + load) never need a token — readstack-data is public.
  const readConfig: GitHubFileClientConfig | null = settings.githubOwner
    ? {
        owner: settings.githubOwner,
        repo: settings.githubRepo,
        path: settings.dataFilePath,
        branch: settings.githubBranch,
      }
    : null;

  // Writes (dispatch/push) attach the PAT once the user has supplied one.
  const githubConfig: GitHubFileClientConfig | null = readConfig
    ? { ...readConfig, token: pat ?? undefined }
    : null;

  const handleUnlocked = useCallback((key: CryptoKey, s: Uint8Array, iters: number) => {
    setUnlockedKey(key);
    setSalt(s);
    setIterations(iters);
  }, []);

  if (unlockedKey && salt && githubConfig) {
    return (
      <DataStoreProvider
        github={githubConfig}
        sessionKey={unlockedKey}
        salt={salt}
        iterations={iterations}
        defaultSettings={settings}
      >
        <UnlockedApp pat={pat} onRequestPat={setPat} />
      </DataStoreProvider>
    );
  }

  return (
    <div className="app-shell">
      <UnlockFlow githubConfig={readConfig} onUnlocked={handleUnlocked} />
      <GitHubRepoBootstrap
        githubOwner={settings.githubOwner}
        githubRepo={settings.githubRepo}
        githubBranch={settings.githubBranch}
        dataFilePath={settings.dataFilePath}
        onChange={updateSettings}
      />
      <SettingsScreen isReturningUser={false} />
    </div>
  );
}

/**
 * Pre-unlock GitHub repo target entry (owner/repo/branch/file path).
 *
 * `usePersistedSettings` (workstream A) already models these fields and
 * `SettingsScreen`'s doc comment claims to cover "githubOwner/repo/path/branch",
 * but none of the settings components actually render an input for them —
 * only `readingSpeedWpm` has a field (`ReadingSpeedField`). Without this,
 * `githubConfig` in `App` can never be assembled and the app can never
 * reach the unlock step. This is a small integration-layer fix (not a new
 * feature) using `usePersistedSettings.updateSettings`, which A already
 * built for exactly this purpose.
 */
function GitHubRepoBootstrap({
  githubOwner,
  githubRepo,
  githubBranch,
  dataFilePath,
  onChange,
}: {
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  dataFilePath: string;
  onChange: (patch: Partial<{ githubOwner: string; githubRepo: string; githubBranch: string; dataFilePath: string }>) => void;
}) {
  return (
    <div className="settings-field" data-testid="github-repo-bootstrap">
      <label htmlFor="github-owner-input">GitHub owner/org</label>
      <p className="settings-field-hint">
        The account that owns the public <code>readstack-data</code> repo. No token
        needed just to read your stack.
      </p>
      <input
        id="github-owner-input"
        type="text"
        value={githubOwner}
        onChange={(e) => onChange({ githubOwner: e.target.value.trim() })}
        placeholder="your-github-username"
        autoComplete="off"
      />
      <details>
        <summary>Advanced: repo / branch / file path</summary>
        <label htmlFor="github-repo-input">Repo name</label>
        <input
          id="github-repo-input"
          type="text"
          value={githubRepo}
          onChange={(e) => onChange({ githubRepo: e.target.value.trim() })}
        />
        <label htmlFor="github-branch-input">Branch</label>
        <input
          id="github-branch-input"
          type="text"
          value={githubBranch}
          onChange={(e) => onChange({ githubBranch: e.target.value.trim() })}
        />
        <label htmlFor="github-path-input">Data file path</label>
        <input
          id="github-path-input"
          type="text"
          value={dataFilePath}
          onChange={(e) => onChange({ dataFilePath: e.target.value.trim() })}
        />
      </details>
    </div>
  );
}

/**
 * PAT entry, requested lazily on first write (see `UnlockedApp`) rather
 * than up front. `usePersistedPat`/`PatField` (C's components, in
 * SettingsScreen) persist it encrypted with the session key for the rest
 * of the tab session once provided; this lightweight field just collects
 * the value in memory for this callback.
 */
function PatBootstrap({ onPat }: { onPat: (pat: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="settings-field-row">
      <input
        id="pat-write-gate-input"
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="github_pat_..."
        autoComplete="off"
      />
      <button type="button" onClick={() => value.trim() && onPat(value.trim())}>
        Use token
      </button>
    </div>
  );
}

export default App;
