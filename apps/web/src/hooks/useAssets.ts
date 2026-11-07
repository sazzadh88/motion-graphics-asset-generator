import { useEffect, useMemo, useState } from 'react';
import { getTemplate, preloadAssets } from '@mg/engine';
import type { LoadedAssets, RenderJobPayload } from '@mg/engine';

export interface AssetsState {
  loaded: LoadedAssets | null;
  /** Template the `loaded` assets (and fonts) were prepared for. */
  loadedTemplateId: string | null;
  loading: boolean;
}

interface Internal {
  loaded: LoadedAssets | null;
  templateId: string | null;
  key: string | null;
}

/**
 * Preloads fonts + images whenever the template or any image value changes.
 * Previously loaded assets stay available while the next set loads.
 */
export function useAssets(payload: RenderJobPayload): AssetsState {
  const { templateId, assets } = payload;
  const key = useMemo(() => {
    const t = getTemplate(templateId);
    const imgs = (t?.params ?? []).filter((p) => p.type === 'image').map((p) => assets[p.key] ?? null);
    return JSON.stringify([templateId, imgs]);
  }, [templateId, assets]);

  const [state, setState] = useState<Internal>({ loaded: null, templateId: null, key: null });

  useEffect(() => {
    let cancelled = false;
    preloadAssets(payload)
      .then((loaded) => {
        if (!cancelled) setState({ loaded, templateId: payload.templateId, key });
      })
      .catch(() => {
        if (!cancelled) setState({ loaded: { images: {} }, templateId: payload.templateId, key });
      });
    return () => {
      cancelled = true;
    };
    // Only template / image changes need a reload; `payload` is captured for that run.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { loaded: state.loaded, loadedTemplateId: state.templateId, loading: state.key !== key };
}
