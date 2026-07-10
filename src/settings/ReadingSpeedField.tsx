/**
 * Reading-speed (wpm) configuration field. Feeds `expectedMs` in the
 * completion formula (`expectedReadingMs` in workstream A's utils) — this is
 * the only tracking-relevant numeric setting the brief calls for.
 */

import { useState, type ChangeEvent } from "react";

const MIN_WPM = 50;
const MAX_WPM = 1000;

export interface ReadingSpeedFieldProps {
  valueWpm: number;
  onChange: (wpm: number) => void;
  disabled?: boolean;
}

export function ReadingSpeedField({ valueWpm, onChange, disabled = false }: ReadingSpeedFieldProps) {
  const [draft, setDraft] = useState(String(valueWpm));

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value);
  }

  function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(valueWpm));
      return;
    }
    const clamped = Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(parsed)));
    setDraft(String(clamped));
    onChange(clamped);
  }

  return (
    <div className="settings-field" data-testid="reading-speed-field">
      <label htmlFor="reading-speed-input">Reading speed (words per minute)</label>
      <p className="settings-field-hint">
        Used to estimate expected reading time (word count ÷ this value) for the
        completion heuristic. Default 200 wpm.
      </p>
      <input
        id="reading-speed-input"
        type="number"
        min={MIN_WPM}
        max={MAX_WPM}
        step={10}
        value={draft}
        onChange={handleChange}
        onBlur={commit}
        disabled={disabled}
      />
    </div>
  );
}
