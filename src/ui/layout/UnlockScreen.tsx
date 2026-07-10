/**
 * Passphrase prompt shown before the app unlocks. Purely UI: collects a
 * passphrase and hands it to the caller's onUnlock, which is expected to
 * call useSessionKey().unlockFresh/unlockWithSalt (workstream A's hook) —
 * this component does not derive keys or touch crypto.ts itself.
 */
import { useState } from "react";

export interface UnlockScreenProps {
  /** True for first-run (no data file exists yet, salt will be generated);
   * false for a returning user (salt comes from the pulled EncryptedPayload,
   * so the caller already knows which unlock path to use). */
  isFirstRun: boolean;
  onUnlock: (passphrase: string) => void;
  isUnlocking?: boolean;
  error?: string | null;
}

export function UnlockScreen({ isFirstRun, onUnlock, isUnlocking = false, error = null }: UnlockScreenProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (passphrase.length < 8) {
      setLocalError("Passphrase must be at least 8 characters.");
      return;
    }
    if (isFirstRun && passphrase !== confirm) {
      setLocalError("Passphrases do not match.");
      return;
    }

    setLocalError(null);
    onUnlock(passphrase);
  };

  return (
    <div className="unlock-screen">
      <form className="unlock-screen__form" onSubmit={handleSubmit}>
        <h1 className="unlock-screen__title">ReadStack</h1>
        <p className="unlock-screen__subtitle">
          {isFirstRun
            ? "Choose a passphrase to encrypt your reading stack. It's never sent anywhere and isn't recoverable if lost."
            : "Enter your passphrase to unlock your reading stack."}
        </p>

        <label className="unlock-screen__field">
          <span>Passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            required
            minLength={8}
          />
        </label>

        {isFirstRun && (
          <label className="unlock-screen__field">
            <span>Confirm passphrase</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </label>
        )}

        {(localError || error) && (
          <p className="unlock-screen__error" role="alert">
            {localError ?? error}
          </p>
        )}

        <button type="submit" disabled={isUnlocking}>
          {isUnlocking ? "Unlocking…" : isFirstRun ? "Create stack" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
