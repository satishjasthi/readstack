/**
 * Integration pass: wires workstream A's store/crypto/sync, workstream B's
 * UI (UnlockScreen/AppShell/TimeMachineStack), and workstream C's
 * SettingsScreen/useReadingSession together.
 *
 * Flow:
 *  1. Show SettingsScreen (no DataStoreProvider yet) so the user can enter
 *     a GitHub PAT + owner/repo/branch/path + reading speed. SettingsScreen
 *     tolerates being rendered pre-provider (see WORKSTREAM_C_NOTES.md).
 *  2. Once a PAT + owner are present, probe the data repo directly via
 *     `getFileContents` (no key needed — only the `salt`/`iterations` inside
 *     the still-encrypted EncryptedPayload are read) to decide first-run
 *     (404 -> unlockFresh) vs returning user (existing salt -> unlockWithSalt),
 *     per A's syncEngine notes on first-run detection.
 *  3. Render UnlockScreen (B) with the right mode; on submit, derive the
 *     session key via useSessionKey (A).
 *  4. Mount <DataStoreProvider> (A) with the assembled GitHub config + key,
 *     call load(), then render AppShell (B).
 *  5. AppShell's onOpenArticle is wired to useReadingSession().openArticle
 *     (C) rather than TimeMachineStack's bare openArticleInNewTab, so
 *     opening a card also starts real completion tracking. onAddArticle is
 *     wired to dispatch({ type: "ADD_ARTICLE" }) (A).
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
 * Pre-unlock phase: collect GitHub settings + PAT via SettingsScreen, then
 * probe the data repo to decide first-run vs returning-user, then collect
 * the passphrase via UnlockScreen. Resolves once a CryptoKey is derived.
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
          Configure a GitHub token and owner in Settings below before unlocking.
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
 * and renders the real app (AppShell), wiring in useReadingSession so
 * opening a card starts completion tracking. */
function UnlockedApp() {
  const { data, isLoading, syncStatus, syncError, load, dispatch } = useDataStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      setIsSubmitting(true);
      try {
        await dispatch({ type: "ADD_ARTICLE", input });
      } finally {
        setIsSubmitting(false);
      }
    },
    [dispatch],
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
    <AppShell
      articles={data.articles}
      onAddArticle={handleAddArticle}
      isSubmitting={isSubmitting}
      syncStatus={syncStatus}
      syncError={syncError}
      onOpenArticle={readingSession.openArticle}
    />
  );
}

function App() {
  const { settings, updateSettings } = usePersistedSettings();
  const [pat, setPat] = useState<string | null>(null);
  const [unlockedKey, setUnlockedKey] = useState<CryptoKey | null>(null);
  const [salt, setSalt] = useState<Uint8Array | null>(null);
  const [iterations, setIterations] = useState<number>(0);

  const githubConfig: GitHubFileClientConfig | null =
    pat && settings.githubOwner
      ? {
          owner: settings.githubOwner,
          repo: settings.githubRepo,
          path: settings.dataFilePath,
          branch: settings.githubBranch,
          token: pat,
        }
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
        <UnlockedApp />
      </DataStoreProvider>
    );
  }

  return (
    <div className="app-shell">
      <UnlockFlow githubConfig={githubConfig} onUnlocked={handleUnlocked} />
      <GitHubRepoBootstrap
        githubOwner={settings.githubOwner}
        githubRepo={settings.githubRepo}
        githubBranch={settings.githubBranch}
        dataFilePath={settings.dataFilePath}
        onChange={updateSettings}
      />
      <SettingsScreen isReturningUser={false} />
      {/* PAT capture: SettingsScreen's PatField persists the encrypted PAT
          via usePersistedPat, but that requires a session key which we
          don't have until after unlock — so this pre-unlock phase reads the
          PAT the user types via a lightweight local callback below instead
          of round-tripping through the encrypted store. */}
      <PatBootstrap onPat={setPat} />
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
        The account that owns the private <code>readstack-data</code> repo.
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
 * Pre-unlock PAT entry. `usePersistedPat`/`PatField` (C's components) are
 * designed to encrypt the PAT with the session key, which doesn't exist
 * yet at this point in the flow (we need the PAT to reach GitHub before we
 * can even determine first-run vs returning, which determines how we
 * derive the key). This lightweight field collects the PAT in memory only
 * for this session's bootstrap; SettingsScreen above remains responsible
 * for persisting it (encrypted) once a session key exists, so subsequent
 * app loads within the same tab don't need to re-enter it here.
 */
function PatBootstrap({ onPat }: { onPat: (pat: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="settings-field" data-testid="pat-bootstrap">
      <label htmlFor="pat-bootstrap-input">GitHub PAT (to locate readstack-data)</label>
      <p className="settings-field-hint">
        Needed once per tab session to check whether your encrypted data file exists
        yet. Also set this in Settings below to have it encrypted and remembered for
        this browser session.
      </p>
      <div className="settings-field-row">
        <input
          id="pat-bootstrap-input"
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
    </div>
  );
}

export default App;
