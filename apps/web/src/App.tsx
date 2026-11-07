import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getTemplate, listTemplates } from '@mg/engine';
import type { RenderJobPayload } from '@mg/engine';
import type { JobStatus, RenderJob, VideoFormat } from '@mg/contract';
import { ExportDialog } from './components/ExportDialog';
import { Inspector } from './components/Inspector';
import { JsonPanel } from './components/JsonPanel';
import { RendersPanel } from './components/RendersPanel';
import { Stage } from './components/Stage';
import { TemplateList } from './components/TemplateList';
import { Timeline } from './components/Timeline';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useAssets } from './hooks/useAssets';
import { usePlayback } from './hooks/usePlayback';
import { useShortcuts } from './hooks/useShortcuts';
import { useStudioTestHook } from './hooks/useStudioTestHook';
import { useRenders } from './state/renders';
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

type Tab = 'inspector' | 'json' | 'renders';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'json', label: 'JSON' },
  { id: 'renders', label: 'Renders' },
];

function jobName(job: RenderJob): string {
  return getTemplate(job.templateId)?.name ?? job.templateId;
}

function Studio({ start }: { start: RenderJobPayload }) {
  const templates = listTemplates();
  const [state, dispatch] = useReducer(reducer, start, initState);
  const [tab, setTab] = useState<Tab>('inspector');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportRef = useRef<HTMLButtonElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [toast, setToast] = useState<RenderJob | null>(null);

  const onStatusChange = useCallback((job: RenderJob, prev: JobStatus) => {
    const name = jobName(job);
    if (job.status === 'completed') {
      setAnnouncement(`Render of ${name} completed.`);
      setToast(job);
    } else if (job.status === 'failed') {
      setAnnouncement(`Render of ${name} failed.`);
    } else if (job.status === 'cancelled') {
      setAnnouncement(`Render of ${name} cancelled.`);
    } else if (job.status === 'active' && prev === 'queued') {
      setAnnouncement(`Render of ${name} started.`);
    }
  }, []);
  const renders = useRenders(onStatusChange);
  const { refresh } = renders;

  // Load the job list whenever the Renders tab opens.
  useEffect(() => {
    if (tab === 'renders') void refresh();
  }, [tab, refresh]);

  const startRender = useCallback(
    async (format: VideoFormat) => {
      const job = await renders.start(state.payload, format);
      setAnnouncement(`Render of ${jobName(job)} queued.`);
      setExporting(false);
      setTab('renders');
    },
    [renders, state.payload],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const { payload, frame, playing, loop } = state;
  const { fps, durationFrames } = payload.settings;
  const template = getTemplate(payload.templateId) ?? templates[0];

  const assets = useAssets(payload);
  useStudioTestHook(payload, frame, assets, dispatch);
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
      <TopBar
        templateName={template.name}
        onDownloadPng={downloadPng}
        onExport={() => setExporting(true)}
        exportRef={exportRef}
        current={renders.current}
        activeCount={renders.activeCount}
        onOpenRenders={() => setTab('renders')}
      />
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
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          className="tabpanel"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === 'inspector' ? (
            <Inspector key={payload.templateId} template={template} payload={payload} dispatch={dispatch} />
          ) : tab === 'json' ? (
            <JsonPanel payload={payload} dispatch={dispatch} onTemplateChange={selectPayload} />
          ) : (
            <RendersPanel renders={renders} />
          )}
        </div>
      </aside>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {toast ? (
        <Toast
          message={`Render complete: ${jobName(toast)}`}
          actionLabel="Download video"
          onAction={() => {
            void renders.download(toast.id);
            setToast(null);
          }}
          onDismiss={dismissToast}
        />
      ) : null}
      {exporting ? (
        <ExportDialog
          payload={payload}
          templateName={template.name}
          onSubmit={startRender}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </div>
  );
}

