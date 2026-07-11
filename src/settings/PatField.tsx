/**
 * GitHub fine-grained PAT entry field.
 *
 * Per the brief: "user supplies a fine-grained GitHub Personal Access Token
 * (scoped to `readstack-data` repo contents, read+write)... Token stored in
 * browser storage (encrypted with the same session passphrase-derived key)
 * — never hardcoded, never committed, never sent anywhere except GitHub's
 * REST API." This component only handles local entry/display; encryption
 * and storage are `usePersistedPat`'s job (wired by the parent
 * SettingsScreen), not this component's.
 */

import { useState, type ChangeEvent } from "react";

export interface PatFieldProps {
  /** Current decrypted PAT value (or null if none stored yet). Used only
   * to show a masked "already configured" affordance — the field itself
   * always starts empty so a real token is never echoed back into the DOM
   * on load. */
  hasStoredValue: boolean;
  /** Called with the raw token string when the user submits a change. */
  onSave: (value: string) => void | Promise<void>;
  disabled?: boolean;
}

export function PatField({ hasStoredValue, onSave, disabled = false }: PatFieldProps) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onSave(value.trim());
      setValue("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-field" data-testid="pat-field">
      <label htmlFor="pat-input">GitHub Personal Access Token</label>
      <p className="settings-field-hint">
        Fine-grained token scoped to <code>readstack-data</code> contents (write
        access — reading your stack never needs this, since the repo is public and
        the file is encrypted). Encrypted with your passphrase before being stored
        in this browser.
        {hasStoredValue ? " A token is currently configured." : " No token configured yet."}
      </p>
      <div className="settings-field-row">
        <input
          id="pat-input"
          type={reveal ? "text" : "password"}
          value={value}
          onChange={handleChange}
          placeholder={hasStoredValue ? "Enter a new token to replace it" : "github_pat_..."}
          autoComplete="off"
          disabled={disabled || saving}
        />
        <button type="button" onClick={() => setReveal((r) => !r)} disabled={disabled}>
          {reveal ? "Hide" : "Show"}
        </button>
        <button type="button" onClick={handleSave} disabled={disabled || saving || !value.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
