import { useEffect, useRef, useState } from 'react';
import type { TemplateDefinition } from '@mg/engine';
import { cachedThumb, requestThumb, thumbDpr, thumbSize } from '../thumbnails';
import { thumbPaletteKey, useReferencePalette } from '../state/referencePalette';

type Status = 'idle' | 'ready' | 'error';

/**
 * 72×72 letterboxed preview of a template's default payload (recolored by the reference
 * palette when it applies to every template); rendered lazily when visible. When the
 * palette changes, the previous bitmap stays on screen until the new one arrives.
 */
export function TemplateThumb({ template }: { template: TemplateDefinition }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dpr] = useState(thumbDpr);
  const reference = useReferencePalette();
  const palKey = thumbPaletteKey(reference);
  const [shown, setShown] = useState<{ bitmap: ImageBitmap; key: string } | null>(() => {
    const b = cachedThumb(template.id, dpr, reference);
    return b ? { bitmap: b, key: palKey } : null;
  });
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const bitmap = shown?.bitmap ?? null;
  const upToDate = shown?.key === palKey;
  const status: Status = errorKey === palKey ? 'error' : bitmap ? 'ready' : 'idle';
  const size = thumbSize(template.defaultSettings);

  // Queue a render while the box is (near) visible; drop it from the queue when it scrolls away.
  useEffect(() => {
    if (upToDate || errorKey === palKey) return;
    const hit = cachedThumb(template.id, dpr, reference);
    if (hit) {
      setShown({ bitmap: hit, key: palKey });
      return;
    }
    const el = boxRef.current;
    if (!el) return;
    let cancel: (() => void) | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !cancel) {
          cancel = requestThumb(
            template.id,
            dpr,
            reference,
            (b) => setShown({ bitmap: b, key: palKey }),
            () => setErrorKey(palKey),
          );
        } else if (!visible && cancel) {
          cancel();
          cancel = null;
        }
      },
      { rootMargin: '96px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancel?.();
    };
  }, [template.id, dpr, reference, palKey, upToDate, errorKey]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !bitmap) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);

  return (
    <span className="tthumb" ref={boxRef} aria-hidden="true" data-state={status}>
      {bitmap ? (
        <canvas
          ref={canvasRef}
          className={template.defaultSettings.transparent ? 'tthumb-img tthumb-checker' : 'tthumb-img'}
          style={{ width: size.w, height: size.h }}
        />
      ) : (
        <span className="tthumb-skeleton" style={{ width: size.w, height: size.h }} />
      )}
    </span>
  );
}
