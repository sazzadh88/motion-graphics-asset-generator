import type { Ref } from 'react';
import type { RenderJob } from '@mg/contract';
import { DownloadIcon } from './Icons';

interface Props {
  templateName: string;
  onDownloadPng: () => void;
  onExport: () => void;
  exportRef: Ref<HTMLButtonElement>;
  /** Job to summarise in the progress chip, if any. */
  current: RenderJob | null;
  activeCount: number;
  onOpenRenders: () => void;
}

export function TopBar({ templateName, onDownloadPng, onExport, exportRef, current, activeCount, onOpenRenders }: Props) {
  const pct = current ? Math.round(current.progress) : 0;
  const text = !current ? '' : current.status === 'queued' ? 'Queued' : `Rendering ${pct}%`;
  const more = activeCount > 1 ? ` +${activeCount - 1}` : '';
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Motion Studio</span>
        <span className="brand-sep" aria-hidden="true">/</span>
        <span className="brand-template">{templateName}</span>
      </div>
      <div className="topbar-actions">
        {current ? (
          <button
            type="button"
            className="chip"
            onClick={onOpenRenders}
            aria-label={`${text}${more ? `, ${activeCount - 1} more` : ''}. View renders`}
          >
            <span className="chip-bar" aria-hidden="true">
              <span style={{ width: `${current.status === 'queued' ? 0 : pct}%` }} />
            </span>
            {text}
            {more}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onDownloadPng} title="Download the current frame as PNG">
          <DownloadIcon />
          Download PNG
        </button>
        <button
          type="button"
          ref={exportRef}
          className="btn primary"
          onClick={onExport}
          aria-haspopup="dialog"
          title="Render the design as a video on the server"
        >
          Export
        </button>
      </div>
    </header>
  );
}
