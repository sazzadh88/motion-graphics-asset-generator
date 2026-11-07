import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { renderFrame } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import type { AssetsState } from '../hooks/useAssets';

interface Props {
  payload: RenderJobPayload;
  frame: number;
  assets: AssetsState;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

const PAD = 32;

export function Stage({ payload, frame, assets, canvasRef }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const { width, height, transparent } = payload.settings;
  const { loaded, loadedTemplateId, loading } = assets;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw only when the frame, the payload or the decoded assets change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded || loadedTemplateId !== payload.templateId) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      renderFrame(ctx, frame, payload, loaded);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed');
    }
  }, [frame, payload, loaded, loadedTemplateId, width, height, canvasRef]);

  const avail = { w: Math.max(0, box.w - PAD * 2), h: Math.max(0, box.h - PAD * 2) };
  const scale = avail.w > 0 && avail.h > 0 ? Math.min(1, avail.w / width, avail.h / height) : 0;

  return (
    <div className="stage" ref={viewportRef}>
      <div
        className={transparent ? 'canvas-wrap checker' : 'canvas-wrap'}
        style={{ width: Math.floor(width * scale), height: Math.floor(height * scale), visibility: scale ? 'visible' : 'hidden' }}
      >
        <canvas ref={canvasRef} width={width} height={height} aria-label="Animation preview" role="img" />
      </div>
      <div className="stage-meta" aria-live="polite">
        <span>
          {width}×{height}
        </span>
        <span>{Math.round(scale * 100)}%</span>
        {loading ? <span className="chip">Loading assets…</span> : null}
      </div>
      {error ? (
        <div className="stage-error" role="alert">
          Render error: {error}
        </div>
      ) : null}
    </div>
  );
}
