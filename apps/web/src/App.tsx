import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getTemplate, listTemplates } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import { Inspector } from './components/Inspector';
import { JsonPanel } from './components/JsonPanel';
import { Stage } from './components/Stage';
import { TemplateList } from './components/TemplateList';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { useAssets } from './hooks/useAssets';
import { usePlayback } from './hooks/usePlayback';
import { useShortcuts } from './hooks/useShortcuts';
import { initState, reducer } from './state/store';
import { loadLastTemplateId, loadPayload, savePayload } from './state/storage';

function initialPayload(): RenderJobPayload | null {
  const all = listTemplates();
  const first = all[0];
  if (!first) return null;
  const last = loadLastTemplateId();
  const id = last && getTemplate(last) ? last : first.id;
  return loadPayload(id);
}

export default function App() {
  const [start] = useState(initialPayload);
  if (!start) return <div className="empty">No templates are registered in the engine.</div>;
  return <Studio start={start} />;
}

type Tab = 'inspector' | 'json';

function Studio({ start }: { start: RenderJobPayload }) {
  const templates = listTemplates();
  const [state, dispatch] = useReducer(reducer, start, initState);
  const [tab, setTab] = useState<Tab>('inspector');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { payload, frame, playing, loop } = state;
  const { fps, durationFrames } = payload.settings;
  const template = getTemplate(payload.templateId) ?? templates[0];

  const assets = useAssets(payload);
  usePlayback(frame, playing, loop, fps, durationFrames, dispatch);
  useShortcuts(frame, durationFrames, dispatch);

  // Persist edits per template (debounced).
  useEffect(() => {
    const t = window.setTimeout(() => savePayload(payload), 300);
    return () => window.clearTimeout(t);
  }, [payload]);

  const selectTemplate = useCallback((id: string) => {
    dispatch({ type: 'selectTemplate', payload: loadPayload(id) });
  }, []);

  const selectPayload = useCallback((p: RenderJobPayload) => {
    dispatch({ type: 'selectTemplate', payload: p });
  }, []);

  const downloadPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${payload.templateId}-frame-${String(frame).padStart(4, '0')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }, [payload.templateId, frame]);

  if (!template) return <div className="empty">Template not found.</div>;

  return (
    <div className="app">
      <TopBar templateName={template.name} onDownloadPng={downloadPng} />
      <aside className="rail">
        <TemplateList templates={templates} activeId={payload.templateId} onSelect={selectTemplate} />
      </aside>
      <main className="center">
        <Stage payload={payload} frame={frame} assets={assets} canvasRef={canvasRef} />
        <Timeline
          frame={frame}
          total={durationFrames}
          fps={fps}
          playing={playing}
          loop={loop}
          dispatch={dispatch}
        />
      </main>
      <aside className="panel">
        <div className="tabs" role="tablist" aria-label="Right panel">
          <button
            type="button"
            role="tab"
            id="tab-inspector"
            aria-selected={tab === 'inspector'}
            aria-controls="panel-inspector"
            onClick={() => setTab('inspector')}
          >
            Inspector
          </button>
          <button
            type="button"
            role="tab"
            id="tab-json"
            aria-selected={tab === 'json'}
            aria-controls="panel-json"
            onClick={() => setTab('json')}
          >
            JSON
          </button>
        </div>
        <div
          className="tabpanel"
          role="tabpanel"
          id={tab === 'inspector' ? 'panel-inspector' : 'panel-json'}
          aria-labelledby={tab === 'inspector' ? 'tab-inspector' : 'tab-json'}
        >
          {tab === 'inspector' ? (
            <Inspector key={payload.templateId} template={template} payload={payload} dispatch={dispatch} />
          ) : (
            <JsonPanel payload={payload} dispatch={dispatch} onTemplateChange={selectPayload} />
          )}
        </div>
      </aside>
    </div>
  );
}

