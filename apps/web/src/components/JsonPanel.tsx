import { useMemo, useState } from 'react';
import type { Dispatch } from 'react';
import { validatePayload } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import type { Action } from '../state/store';
import { CopyIcon } from './Icons';

interface Props {
  payload: RenderJobPayload;
  dispatch: Dispatch<Action>;
  /** Called when applied JSON targets a different template. */
  onTemplateChange: (payload: RenderJobPayload) => void;
}

type Check = { ok: true; payload: RenderJobPayload } | { ok: false; errors: string[] };

function check(text: string): Check {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`] };
  }
  const r = validatePayload(data);
  return r.ok ? { ok: true, payload: r.payload } : { ok: false, errors: r.errors };
}

export function JsonPanel({ payload, dispatch, onTemplateChange }: Props) {
  const json = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const result = useMemo(() => (editing ? check(draft) : null), [editing, draft]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(editing ? draft : json);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(null), 1500);
  };

  const apply = () => {
    if (!result || !result.ok) return;
    if (result.payload.templateId !== payload.templateId) onTemplateChange(result.payload);
    else dispatch({ type: 'applyPayload', payload: result.payload });
    setEditing(false);
  };

  return (
    <div className="json-panel">
      <div className="json-toolbar">
        <button type="button" className="btn" onClick={() => void copy()}>
          <CopyIcon />
          {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy JSON'}
        </button>
        {editing ? (
          <>
            <button type="button" className="btn primary" disabled={!result?.ok} onClick={apply}>
              Apply JSON
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(json);
              setEditing(true);
            }}
          >
            Edit JSON
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          className="json-editor"
          aria-label="Payload JSON"
          spellCheck={false}
          value={draft}
          aria-invalid={result ? !result.ok : false}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <pre className="json-view" tabIndex={0} aria-label="Payload JSON (read only)">
          {json}
        </pre>
      )}

      {result && !result.ok ? (
        <ul className="json-errors" role="alert">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {result?.ok ? <p className="ok">Valid payload. Missing assets are filled with defaults.</p> : null}
    </div>
  );
}
