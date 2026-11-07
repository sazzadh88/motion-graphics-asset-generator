import { useId, useRef, useState } from 'react';
import type { Dispatch, DragEvent } from 'react';
import type { RenderJobPayload } from '@mg/engine';
import type { Action } from '../state/store';
import {
  ImageReadError,
  clearOriginals,
  getReference,
  originalColors,
  palettePatch,
  readReferenceImage,
  setReference,
  updateReference,
  useReferencePalette,
} from '../state/referencePalette';
import type { ReferencePalette as Reference } from '../state/referencePalette';
import { ImageIcon, ShuffleIcon } from './Icons';
import { Switch } from './Switch';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

const MESSAGES = {
  decode: "Couldn't read that image. Try a PNG, JPEG or WebP.",
  size: 'That image is too large (max 20 MB).',
} as const;

interface Props {
  payload: RenderJobPayload;
  dispatch: Dispatch<Action>;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/** Inspector section: pick a reference image, extract its palette, apply it to color params. */
export function ReferencePalette({ payload, dispatch }: Props) {
  const base = useId();
  const reference = useReferencePalette();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (ref: Reference) => {
    const patch = palettePatch(payload, ref);
    if (Object.keys(patch).length) dispatch({ type: 'setAssets', patch });
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { palette, thumbDataUrl } = await readReferenceImage(file);
      const prev = getReference();
      const next: Reference = { palette, variant: 0, applyAll: prev?.applyAll ?? true, thumbDataUrl };
      setReference(next);
      apply(next);
    } catch (e) {
      setError(MESSAGES[e instanceof ImageReadError ? e.reason : 'decode']);
    } finally {
      setBusy(false);
    }
  };

  const openPicker = () => inputRef.current?.click();

  const shuffle = () => {
    if (!reference) return;
    const next = { ...reference, variant: reference.variant + 1 };
    setReference(next);
    apply(next);
  };

  const remove = () => {
    const orig = originalColors(payload.templateId);
    if (orig && Object.keys(orig).length) dispatch({ type: 'setAssets', patch: orig });
    clearOriginals();
    setReference(null);
    setError(null);
  };

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !e.currentTarget.contains(to)) setDragOver(false);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragOver(false);
    void loadFile(e.dataTransfer.files[0]);
  };

  const total = reference ? reference.palette.colors.reduce((s, c) => s + c.weight, 0) || 1 : 1;
  const label = reference
    ? 'Palette: ' +
      reference.palette.colors.map((c) => `${c.hex} ${Math.round((c.weight / total) * 100)}%`).join(', ')
    : '';

  return (
    <details className="section" open onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <summary>Reference palette</summary>
      <div className="section-body">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          tabIndex={-1}
          onChange={(e) => {
            void loadFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {reference ? (
          <>
            <div className={dragOver ? 'refpal-row is-dragover' : 'refpal-row'}>
              <img className="refpal-thumb" src={reference.thumbDataUrl} alt="Reference image" />
              <div className="refpal-strip" role="img" aria-label={label}>
                {reference.palette.colors.map((c, i) => (
                  <span
                    key={`${c.hex}-${i}`}
                    className="refpal-swatch"
                    title={c.hex}
                    style={{ background: c.hex, flexGrow: c.weight / total }}
                  />
                ))}
              </div>
            </div>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="row refpal-actions">
              <button type="button" className="btn" title="Try another arrangement" onClick={shuffle} disabled={busy}>
                <ShuffleIcon />
                Shuffle
              </button>
              <button type="button" className="btn" onClick={openPicker} disabled={busy}>
                Replace…
              </button>
              <button type="button" className="btn" onClick={remove} disabled={busy}>
                Remove
              </button>
            </div>
            <div className="field field-inline">
              <label className="label" htmlFor={`${base}-all`}>
                Apply to every template
              </label>
              <Switch
                id={`${base}-all`}
                checked={reference.applyAll}
                onChange={(v) => updateReference({ applyAll: v })}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <button
              type="button"
              className={dragOver ? 'refpal-drop is-dragover' : 'refpal-drop'}
              onClick={openPicker}
              disabled={busy}
            >
              <ImageIcon />
              Drop an image or choose a file
            </button>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <p className="hint">Colors are matched on your device; the image isn't uploaded.</p>
          </div>
        )}
      </div>
    </details>
  );
}
