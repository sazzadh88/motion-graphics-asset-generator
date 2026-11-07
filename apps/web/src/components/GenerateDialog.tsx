import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { SIZE_PRESETS, getTemplate, listTemplates } from '@mg/engine';
import type { Palette, RenderJobPayload } from '@mg/engine';
import type { GenerateEvent, GenerateRequest, GeneratedTemplate } from '@mg/contract';
import {
  ApiRequestError,
  deleteScene,
  describeError,
  getGenerateStatus,
  keepScene,
  streamGenerate,
  uploadAsset,
} from '../api/client';
import { addGenerated, discardQuietly, markKept, removeGenerated } from '../state/generated';
import { ImageReadError, readReferenceImage, useReferencePalette } from '../state/referencePalette';
import { CheckIcon, CloseIcon, ImageIcon, SparklesIcon } from './Icons';
import { TemplateThumb } from './TemplateThumb';

interface Props {
  payload: RenderJobPayload;
  /** Selects a template through the app's normal selection path. */
  onSelect: (id: string) => void;
  onClose: () => void;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const DURATIONS = [3, 4, 5, 6, 8, 10, 12, 15];
const FPS = 30;
const MAX_PROMPT = 2000;
const PLACEHOLDER = 'Launch teaser for a coffee subscription. Bold headline, a price badge that pops in, warm and calm.';
const OFFLINE = "Can't reach the API server. Start it with npm run dev.";
const DISABLED_FIX = 'Set ANTHROPIC_API_KEY on the API server, then restart it.';
const BUSY = 'Another generation is running. Try again in a moment.';
const IMAGE_MESSAGES = {
  decode: "Couldn't read that image. Try a PNG, JPEG or WebP.",
  size: 'That image is too large (max 20 MB).',
} as const;

type Status = { kind: 'unknown' } | { kind: 'enabled' } | { kind: 'disabled'; reason: string } | { kind: 'offline' };
type Phase = 'compose' | 'generating' | 'result' | 'error';

interface RefImage {
  file: File;
  palette: Palette;
  thumbDataUrl: string;
  /** Set once uploaded, so retries do not upload again. */
  url?: string;
}

interface Progress {
  step: 'writing' | 'checking' | 'saving' | 'done';
  /** Issues found by the last check (shown while repairing). */
  issues: number;
  repairing: boolean;
  /** Issues fixed by repairs so far. */
  fixed: number;
}

const START: Progress = { step: 'writing', issues: 0, repairing: false, fixed: 0 };
const STEP_ORDER = ['writing', 'checking', 'saving', 'done'] as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function normalisePalette(p: Palette): GenerateRequest['palette'] {
  const total = p.colors.reduce((s, c) => s + Math.max(0, c.weight), 0) || 1;
  return {
    colors: p.colors.slice(0, 16).map((c) => ({
      hex: c.hex,
      weight: Math.round(Math.min(1, Math.max(0, c.weight / total)) * 10000) / 10000,
    })),
  };
}

function Swatches({ palette, label }: { palette: Palette; label: string }) {
  const total = palette.colors.reduce((s, c) => s + c.weight, 0) || 1;
  const desc = `${label}: ${palette.colors.map((c) => `${c.hex} ${Math.round((c.weight / total) * 100)}%`).join(', ')}`;
  return (
    <span className="refpal-strip gen-strip" role="img" aria-label={desc}>
      {palette.colors.map((c, i) => (
        <span
          key={`${c.hex}-${i}`}
          className="refpal-swatch"
          title={c.hex}
          style={{ background: c.hex, flexGrow: c.weight / total }}
        />
      ))}
    </span>
  );
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/** "Generate a template": compose → generating → result / error, in one native modal <dialog>. */
export function GenerateDialog({ payload, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refineRef = useRef<HTMLInputElement>(null);
  const base = useId();
  const reference = useReferencePalette();

  const [status, setStatus] = useState<Status>({ kind: 'unknown' });
  const [phase, setPhase] = useState<Phase>('compose');

  // compose inputs
  const [prompt, setPrompt] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const [image, setImage] = useState<RefImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [skipReference, setSkipReference] = useState(false);
  const [preset, setPreset] = useState(() => {
    const i = SIZE_PRESETS.findIndex((p) => p.width === payload.settings.width && p.height === payload.settings.height);
    return i >= 0 ? i : 0;
  });
  const [seconds, setSeconds] = useState(6);

  // generating / result / error
  const [progress, setProgress] = useState<Progress>(START);
  const [result, setResult] = useState<GeneratedTemplate | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [refineError, setRefineError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; issues: string[] } | null>(null);

  /** Template selected before the first generation (Discard goes back to it). */
  const [beforeId] = useState(payload.templateId);
  const abortRef = useRef<AbortController | null>(null);
  /** Phase to return to when the user cancels a running generation. */
  const cancelToRef = useRef<Phase>('compose');
  /** The request that produced the current result (Try again repeats it). */
  const lastRequestRef = useRef<GenerateRequest | null>(null);
  /** The request that just failed (Try again in the error state repeats it). */
  const failedRequestRef = useRef<GenerateRequest | null>(null);
  /** Unkept drafts replaced by a newer result; deleted once no request depends on them. */
  const supersededRef = useRef(new Set<string>());

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    getGenerateStatus()
      .then((s) => {
        if (!live) return;
        setStatus(s.enabled ? { kind: 'enabled' } : { kind: 'disabled', reason: s.reason ?? 'Generation is not configured on the API server.' });
      })
      .catch(() => {
        if (live) setStatus({ kind: 'offline' });
      });
    return () => {
      live = false;
    };
  }, []);

  // Closing the dialog aborts a running generation and cleans up replaced drafts.
  useEffect(() => {
    const superseded = supersededRef.current;
    return () => {
      abortRef.current?.abort();
      for (const id of superseded) void discardQuietly(id);
      superseded.clear();
    };
  }, []);

  const unavailable = status.kind === 'disabled' || status.kind === 'offline';
  useEffect(() => {
    if (unavailable) closeRef.current?.focus();
  }, [unavailable]);

  const close = () => ref.current?.close();

  /**
   * Deletes replaced drafts. `except` (the base of the current result's refine request) stays on
   * the server so Try again can repeat that request, but leaves the library right away; it is
   * deleted on the next flush (Keep, Discard, a later result, or closing the dialog).
   */
  const flushSuperseded = (except?: string | null) => {
    for (const id of [...supersededRef.current]) {
      if (id === except) {
        removeGenerated(id);
        continue;
      }
      supersededRef.current.delete(id);
      void discardQuietly(id);
    }
  };

  // ------------------------------------------------------------ reference image
  const loadImage = async (file: File | undefined) => {
    if (!file) return;
    setImageError(null);
    setImageBusy(true);
    try {
      const { palette, thumbDataUrl } = await readReferenceImage(file);
      setImage({ file, palette, thumbDataUrl });
    } catch (e) {
      setImageError(IMAGE_MESSAGES[e instanceof ImageReadError ? e.reason : 'decode']);
    } finally {
      setImageBusy(false);
    }
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
    void loadImage(e.dataTransfer.files[0]);
  };

  const referencePalette = !image && reference && !skipReference ? reference.palette : null;

  // ------------------------------------------------------------ generation
  const onEvent = useCallback((e: GenerateEvent) => {
    setProgress((p) => {
      if (e.type === 'issues') return { ...p, issues: e.issues.length };
      if (e.type === 'done') return { ...p, step: 'done', repairing: false };
      if (e.type !== 'step') return p;
      switch (e.step) {
        case 'writing':
          return { ...p, step: 'writing', repairing: false };
        case 'checking':
          return { ...p, step: 'checking', repairing: false };
        case 'repairing':
          return { ...p, step: 'checking', repairing: true, fixed: p.fixed + p.issues };
        case 'saving':
          return { ...p, step: 'saving', repairing: false };
      }
    });
  }, []);

  const run = async (prepare: () => Promise<GenerateRequest>, returnTo: Phase) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    cancelToRef.current = returnTo;
    setProgress(START);
    setActionError(null);
    setFailure(null);
    setPhase('generating');

    let req: GenerateRequest | null = null;
    try {
      req = await prepare();
      if (ac.signal.aborted) return;
      const end = await streamGenerate(req, ac.signal, onEvent);
      if (ac.signal.aborted) return;
      if (end.type === 'error') {
        failedRequestRef.current = req;
        setFailure({ message: end.error, issues: end.issues ?? [] });
        setPhase('error');
        return;
      }
      const rec = end.template;
      try {
        addGenerated(rec);
      } catch (e) {
        failedRequestRef.current = req;
        setFailure({
          message: 'The generated template could not be loaded in the studio.',
          issues: e instanceof Error ? e.message.split('\n').slice(1).map((s) => s.trim()) : [],
        });
        setPhase('error');
        void discardQuietly(rec.id);
        return;
      }
      const previous = result;
      if (previous && !previous.kept) supersededRef.current.add(previous.id);
      onSelect(rec.id);
      lastRequestRef.current = req;
      flushSuperseded(req.baseSceneId);
      setResult(rec);
      setRefineOpen(false);
      setRefineText('');
      setRefineError(null);
      setPhase('result');
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof ApiRequestError && e.status === 503 && !e.offline) {
        setStatus({ kind: 'disabled', reason: e.message });
        setPhase('compose');
        return;
      }
      failedRequestRef.current = req;
      const message =
        e instanceof ApiRequestError
          ? e.offline
            ? OFFLINE
            : e.status === 429
              ? BUSY
              : e.message
          : describeError(e);
      const issues = e instanceof ApiRequestError ? e.details : [];
      setFailure({ message, issues });
      setPhase('error');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase(cancelToRef.current);
  };

  const submit = () => {
    const text = prompt.trim();
    if (!text) {
      setPromptError('Describe what to make first.');
      textareaRef.current?.focus();
      return;
    }
    setPromptError(null);
    const size = SIZE_PRESETS[preset] ?? SIZE_PRESETS[0]!;
    const img = image;
    const palette = img ? img.palette : referencePalette;
    void run(async () => {
      let imageUrl: string | null = null;
      if (img) {
        imageUrl = img.url ?? (await uploadAsset(img.file)).url;
        if (!img.url) {
          img.url = imageUrl;
          setImage((cur) => (cur && cur.file === img.file ? { ...cur, url: imageUrl! } : cur));
        }
      }
      return {
        prompt: text,
        imageUrl,
        palette: palette ? normalisePalette(palette) : null,
        width: size.width,
        height: size.height,
        fps: FPS,
        durationSeconds: seconds,
        baseSceneId: null,
      };
    }, 'compose');
  };

  const applyRefine = () => {
    const last = lastRequestRef.current;
    const text = refineText.trim();
    if (!result || !last) return;
    if (!text) {
      setRefineError('Describe what should change first.');
      refineRef.current?.focus();
      return;
    }
    void run(async () => ({ ...last, prompt: text, baseSceneId: result.id }), 'result');
  };

  const tryAgainFromResult = () => {
    const last = lastRequestRef.current;
    if (last) void run(async () => last, 'result');
  };

  const tryAgainFromError = () => {
    const req = failedRequestRef.current;
    if (req) void run(async () => req, result ? 'result' : 'compose');
    else submit();
  };

  const keep = async () => {
    if (!result) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await keepScene(result.id);
      markKept(result.id);
      setResult({ ...result, kept: true });
      flushSuperseded();
      close();
    } catch (e) {
      setActionError(e instanceof ApiRequestError && e.offline ? OFFLINE : describeError(e));
    } finally {
      setActionBusy(false);
    }
  };

  const discard = async () => {
    if (!result) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteScene(result.id);
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.status === 404)) {
        setActionError(
          e instanceof ApiRequestError && e.status === 409
            ? 'This template is being rendered. Try again when the render finishes.'
            : e instanceof ApiRequestError && e.offline
              ? OFFLINE
              : describeError(e),
        );
        setActionBusy(false);
        return;
      }
    }
    const back =
      beforeId !== result.id && getTemplate(beforeId)
        ? beforeId
        : (listTemplates().find((t) => t.origin !== 'generated')?.id ?? beforeId);
    onSelect(back);
    removeGenerated(result.id);
    flushSuperseded();
    setActionBusy(false);
    close();
  };

  // ------------------------------------------------------------ rendering
  const titleId = `${base}-title`;
  const resultTemplate = result ? getTemplate(result.id) : undefined;

  const stepState = (key: 'writing' | 'checking' | 'saving') => {
    const cur = STEP_ORDER.indexOf(progress.step);
    const mine = STEP_ORDER.indexOf(key);
    return mine < cur ? 'done' : mine === cur ? 'active' : 'pending';
  };
  const checkingLabel = () => {
    if (progress.repairing) return `Fixing ${plural(progress.issues, 'issue')}…`;
    if (stepState('checking') === 'done' && progress.fixed > 0) return `Checking it, fixed ${plural(progress.fixed, 'issue')}`;
    return 'Checking it';
  };
  const steps = [
    { key: 'writing' as const, label: 'Writing the scene' },
    { key: 'checking' as const, label: checkingLabel() },
    { key: 'saving' as const, label: 'Saving' },
  ];

  const body = () => {
    if (status.kind === 'offline' || status.kind === 'disabled') {
      return (
        <>
          <div className="gen-unavailable">
            {status.kind === 'offline' ? (
              <p>{OFFLINE}</p>
            ) : (
              <>
                <p>AI generation isn't set up yet.</p>
                <p>{DISABLED_FIX}</p>
              </>
            )}
          </div>
          <div className="dialog-actions">
            <button ref={closeRef} type="button" className="btn" onClick={close}>
              Close
            </button>
          </div>
        </>
      );
    }

    if (phase === 'generating') {
      return (
        <>
          <ol className="gen-steps" aria-live="polite" aria-label="Progress">
            {steps.map((s) => {
              const st = stepState(s.key);
              return (
                <li key={s.key} className="gen-step" data-state={st}>
                  <span className="gen-step-icon" aria-hidden="true">
                    {st === 'done' ? <CheckIcon /> : st === 'active' ? <span className="gen-spinner" /> : <span className="gen-dot" />}
                  </span>
                  <span>{s.label}</span>
                  <span className="sr-only">{st === 'done' ? ' (done)' : st === 'active' ? ' (in progress)' : ''}</span>
                </li>
              );
            })}
          </ol>
          <p className="hint">Usually 20–60 s.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      );
    }

    if (phase === 'result' && result) {
      return (
        <>
          <div className="gen-result">
            {resultTemplate ? <TemplateThumb template={resultTemplate} /> : null}
            <div className="gen-result-text">
              <p className="gen-result-name">{result.name}</p>
              <p className="hint">
                Saved as a draft in Your templates · {plural(resultTemplate?.params.length ?? 0, 'editable setting')}
              </p>
            </div>
          </div>
          {refineOpen ? (
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                applyRefine();
              }}
            >
              <label className="label" htmlFor={`${base}-refine`}>
                What should change?
              </label>
              <div className="row">
                <input
                  ref={refineRef}
                  id={`${base}-refine`}
                  className="input"
                  maxLength={MAX_PROMPT}
                  value={refineText}
                  aria-invalid={refineError ? 'true' : undefined}
                  aria-describedby={refineError ? `${base}-refine-error` : undefined}
                  onChange={(e) => {
                    setRefineText(e.target.value);
                    if (refineError) setRefineError(null);
                  }}
                />
                <button type="submit" className="btn" disabled={actionBusy}>
                  Apply
                </button>
              </div>
              {refineError ? (
                <p className="error" id={`${base}-refine-error`}>
                  {refineError}
                </p>
              ) : null}
            </form>
          ) : null}
          {actionError ? (
            <p className="error-box" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={actionBusy} onClick={() => void discard()}>
              Discard
            </button>
            <button type="button" className="btn" disabled={actionBusy} onClick={tryAgainFromResult}>
              Try again
            </button>
            <button
              type="button"
              className="btn"
              disabled={actionBusy}
              aria-expanded={refineOpen}
              onClick={() => {
                setRefineOpen(true);
                window.setTimeout(() => refineRef.current?.focus(), 0);
              }}
            >
              Refine…
            </button>
            <button type="button" className="btn primary" disabled={actionBusy} onClick={() => void keep()}>
              Keep
            </button>
          </div>
        </>
      );
    }

    if (phase === 'error' && failure) {
      return (
        <>
          <div className="gen-failure" role="alert">
            <p>{failure.message}</p>
            {failure.issues.length > 0 ? (
              <details>
                <summary>Show details</summary>
                <ul className="gen-issues">
                  {failure.issues.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPhase('compose')}>
              Edit prompt
            </button>
            <button type="button" className="btn primary" onClick={tryAgainFromError}>
              Try again
            </button>
          </div>
        </>
      );
    }

    // compose
    return (
      <form
        className="gen-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label className="label" htmlFor={`${base}-prompt`}>
            Describe it
          </label>
          <textarea
            ref={textareaRef}
            id={`${base}-prompt`}
            className="input"
            rows={4}
            required
            maxLength={MAX_PROMPT}
            placeholder={PLACEHOLDER}
            value={prompt}
            aria-invalid={promptError ? 'true' : undefined}
            aria-describedby={promptError ? `${base}-prompt-error` : undefined}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (promptError && e.target.value.trim()) setPromptError(null);
            }}
          />
          {promptError ? (
            <p className="error" id={`${base}-prompt-error`}>
              {promptError}
            </p>
          ) : null}
        </div>

        <div className="gen-row">
          <div className="field">
            <span className="label" id={`${base}-image-label`}>
              Reference image (optional)
            </span>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              tabIndex={-1}
              onChange={(e) => {
                void loadImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {image ? (
              <div
                className={dragOver ? 'gen-image is-dragover' : 'gen-image'}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <img className="gen-image-thumb" src={image.thumbDataUrl} alt="Reference image" />
                <Swatches palette={image.palette} label="Image palette" />
                <button
                  type="button"
                  className="btn icon gen-image-remove"
                  aria-label="Remove reference image"
                  title="Remove"
                  onClick={() => setImage(null)}
                >
                  <CloseIcon />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={dragOver ? 'refpal-drop gen-drop is-dragover' : 'refpal-drop gen-drop'}
                aria-describedby={`${base}-image-label`}
                disabled={imageBusy}
                onClick={() => fileRef.current?.click()}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <ImageIcon />
                Drop or choose
              </button>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor={`${base}-format`}>
              Format
            </label>
            <select
              id={`${base}-format`}
              className="input"
              value={String(preset)}
              onChange={(e) => setPreset(Number(e.target.value))}
            >
              {SIZE_PRESETS.map((p, i) => (
                <option key={p.label} value={String(i)}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor={`${base}-length`}>
              Length
            </label>
            <select
              id={`${base}-length`}
              className="input"
              value={String(seconds)}
              onChange={(e) => setSeconds(Number(e.target.value))}
            >
              {DURATIONS.map((d) => (
                <option key={d} value={String(d)}>
                  {d} s
                </option>
              ))}
            </select>
          </div>
        </div>
        {imageError ? (
          <p className="error" role="alert">
            {imageError}
          </p>
        ) : null}
        {referencePalette ? (
          <div className="gen-refline">
            <span className="hint">Using your reference palette</span>
            <Swatches palette={referencePalette} label="Reference palette" />
            <button type="button" className="gen-link" onClick={() => setSkipReference(true)}>
              Don't use
            </button>
          </div>
        ) : null}
        <p className="hint">The image is sent to Claude to read its style and layout. Its colors are applied to the result.</p>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <SparklesIcon />
            Generate
          </button>
        </div>
      </form>
    );
  };

  return (
    <dialog
      ref={ref}
      className="dialog gen-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current && phase !== 'generating') close();
      }}
    >
      <div className="dialog-body">
        <div className="gen-head">
          <h2 id={titleId} className="dialog-title">
            Generate a template
          </h2>
          <button type="button" className="btn icon gen-close" aria-label="Close" title="Close" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        {body()}
      </div>
    </dialog>
  );
}
