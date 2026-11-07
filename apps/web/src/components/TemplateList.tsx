import type { TemplateDefinition } from '@mg/engine';

interface Props {
  templates: TemplateDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function TemplateList({ templates, activeId, onSelect }: Props) {
  return (
    <nav className="templates" aria-label="Templates">
      <h2 className="panel-title">Templates</h2>
      <ul>
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="template-item"
              aria-current={t.id === activeId ? 'true' : undefined}
              onClick={() => onSelect(t.id)}
            >
              <span className="template-name">{t.name}</span>
              <span className="template-desc">{t.description}</span>
              <span className="template-meta">
                {t.defaultSettings.width}×{t.defaultSettings.height} · {t.defaultSettings.fps} fps
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
