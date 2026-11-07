import { useState } from 'react';

interface Props {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Commit on every valid keystroke (otherwise on blur / Enter). */
  live?: boolean;
  'aria-label'?: string;
  onCommit: (value: number) => void;
}

function parse(s: string): number | null {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Numeric text input with a local draft so partial typing never fights the store. */
export function NumField({ id, value, min, max, step, unit, live, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const parsed = draft === null ? value : parse(draft);
  const invalid = parsed === null || parsed < min || parsed > max;

  const commit = () => {
    if (draft === null) return;
    const n = parse(draft);
    if (n !== null) onCommit(Math.min(max, Math.max(min, n)));
    setDraft(null);
  };

  return (
    <span className="numfield">
      <input
        id={id}
        className="input num"
        type="text"
        inputMode="decimal"
        value={shown}
        aria-label={rest['aria-label']}
        aria-invalid={invalid && draft !== null}
        data-step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          if (live) {
            const n = parse(e.target.value);
            if (n !== null && n >= min && n <= max) onCommit(n);
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      {unit ? <span className="unit">{unit}</span> : null}
    </span>
  );
}
