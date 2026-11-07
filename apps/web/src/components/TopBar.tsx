import { DownloadIcon } from './Icons';

interface Props {
  templateName: string;
  onDownloadPng: () => void;
}

export function TopBar({ templateName, onDownloadPng }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Motion Studio</span>
        <span className="brand-sep" aria-hidden="true">/</span>
        <span className="brand-template">{templateName}</span>
      </div>
      <div className="topbar-actions">
        <button type="button" className="btn" onClick={onDownloadPng} title="Download the current frame as PNG">
          <DownloadIcon />
          Download PNG
        </button>
        <span title="Server rendering arrives in Milestone 4" className="tooltip-wrap">
          <button type="button" className="btn primary" disabled aria-disabled="true">
            Export
          </button>
        </span>
      </div>
    </header>
  );
}
