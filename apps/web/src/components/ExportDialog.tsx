import { useEffect, useId, useRef, useState } from 'react';
import type { RenderJobPayload } from '@mg/engine';
import { ASSET_URL_PATTERN } from '@mg/contract';
import type { VideoFormat } from '@mg/contract';
import { ApiRequestError, describeError } from '../api/client';

interface Props {
  payload: RenderJobPayload;
  templateName: string;
  onSubmit: (format: VideoFormat) => Promise<void>;
  onClose: () => void;
}

const FORMATS: { value: VideoFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
];

/** Image params that hold a pasted URL rather than an uploaded asset. */
function externalImages(payload: RenderJobPayload): string[] {
  return Object.values(payload.assets).filter(
    (v): v is string => typeof v === 'string' && /^(https?:\/\/|data:image\/)/i.test(v) && !ASSET_URL_PATTERN.test(v),
  );
}

/** Native modal <dialog>: traps focus, closes on Esc and returns focus to the opener. */
export function ExportDialog({ payload, templateName, onSubmit, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { width, height, fps, durationFrames, transparent } = payload.settings;
  const [format, setFormat] = useState<VideoFormat>(transparent ? 'webm' : 'mp4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const seconds = Math.round((durationFrames / fps) * 100) / 100;
  const external = externalImages(payload);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(format);
    } catch (e) {
      setError({
        message: e instanceof ApiRequestError && e.status === 400 ? 'The server rejected this render:' : describeError(e),
        details: e instanceof ApiRequestError ? e.details : [],
      });
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) ref.current?.close();
      }}
    >
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id={titleId} className="dialog-title">
          Export video
        </h2>
        <p className="hint">{templateName}</p>

        <fieldset className="field fieldset">
          <legend className="label">Format</legend>
          <div className="segmented">
            {FORMATS.map((f) => (
              <label key={f.value} className={format === f.value ? 'seg on' : 'seg'}>
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                />
                {f.label}
              </label>
            ))}
          </div>
          {transparent ? (
            <p className={format === 'mp4' ? 'warn' : 'hint'}>
              {format === 'mp4'
                ? 'MP4 drops transparency: the background will render opaque. Choose WebM to keep it.'
                : 'WebM keeps the transparent background.'}
            </p>
          ) : null}
        </fieldset>

        <p className="summary">
          {width}×{height} · {fps} fps · {seconds}s · {durationFrames} frames
        </p>

        {external.length > 0 ? (
          <p className="warn">
            This design uses a pasted image URL. Only uploaded images can be exported, so the server will reject it.
          </p>
        ) : null}

        {error ? (
          <div className="error-box" role="alert">
            <p>{error.message}</p>
            {error.details.length > 0 ? (
              <ul>
                {error.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Starting…' : 'Render video'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
