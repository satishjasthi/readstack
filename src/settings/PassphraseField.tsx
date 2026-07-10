/**
 * Passphrase entry for the session's encryption key.
 *
 * Per the brief: key is derived via PBKDF2 from a user-entered passphrase
 * each session, lives only in memory/sessionStorage, never persisted to
 * disk. This component collects the passphrase and hands it to the caller
 * (typically wired to `useSessionKey().unlockFresh` / `unlockWithSalt` at
 * the App.tsx integration layer, per WORKSTREAM_A_NOTES.md) — it does not
 * touch `useSessionKey` directly so it stays reusable for both first-time
 * setup and returning-user unlock flows.
 */

import { useState, type ChangeEvent, type FormEvent } from "react";

export interface PassphraseFieldProps {
  /** "fresh" (first-time, generates a new salt) vs "unlock" (returning
   * user, salt already known) — only affects copy shown to the user. */
  mode: "fresh" | "unlock";
  onSubmit: (passphrase: string) => void | Promise<void>;
  disabled?: boolean;
  error?: string | null;
}

export function PassphraseField({ mode, onSubmit, disabled = false, error }: PassphraseFieldProps) {
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
    setMismatch(false);
  }

  function handleConfirmChange(event: ChangeEvent<HTMLInputElement>) {
    setConfirm(event.target.value);
    setMismatch(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value) return;
    if (mode === "fresh" && value !== confirm) {
      setMismatch(true);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(value);
      setValue("");
      setConfirm("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="settings-field" data-testid="passphrase-field" onSubmit={handleSubmit}>
      <label htmlFor="passphrase-input">
        {mode === "fresh" ? "Choose an encryption passphrase" : "Enter your passphrase"}
      </label>
      <p className="settings-field-hint">
        Used to derive your encryption key each session. Never sent anywhere, never
        stored on disk. If you forget it, your encrypted data cannot be recovered.
      </p>
      <input
        id="passphrase-input"
        type="password"
        value={value}
        onChange={handleChange}
        autoComplete="off"
        disabled={disabled || submitting}
      />
      {mode === "fresh" && (
        <input
          id="passphrase-confirm-input"
          type="password"
          placeholder="Confirm passphrase"
          value={confirm}
          onChange={handleConfirmChange}
          autoComplete="off"
          disabled={disabled || submitting}
        />
      )}
      {mismatch && <p className="settings-field-error">Passphrases do not match.</p>}
      {error && <p className="settings-field-error">{error}</p>}
      <button type="submit" disabled={disabled || submitting || !value}>
        {submitting ? "Unlocking…" : mode === "fresh" ? "Create" : "Unlock"}
      </button>
    </form>
  );
}
