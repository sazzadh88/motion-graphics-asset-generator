import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { SCENE_CATEGORIES } from '@mg/engine';
import type { TemplateDefinition } from '@mg/engine';
import { TemplateThumb } from './TemplateThumb';
import { SparklesIcon, TrashIcon } from './Icons';
import { isDraft } from '../state/generated';

interface Props {
  templates: TemplateDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Opens the Generate dialog. */
  onGenerate: () => void;
  /** Asks to delete a generated template. */
  onDelete: (id: string) => void;
}

interface Group {
  key: string;
  label: string;
  items: TemplateDefinition[];
}

const OTHER = '\u0000other';
const YOURS = '\u0000yours';

function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function formatSeconds(frames: number, fps: number): string {
  const s = frames / fps;
  return `${Number.isInteger(s) ? s : Number(s.toFixed(1))}s`;
}

/**
 * "Your templates" (generated) first, then known categories in SCENE_CATEGORIES order, then
 * unknown ones (alphabetical), then "Other".
 */
function groupTemplates(templates: TemplateDefinition[]): Group[] {
  const known: readonly string[] = SCENE_CATEGORIES;
  const buckets = new Map<string, TemplateDefinition[]>();
  const yours = templates.filter((t) => t.origin === 'generated');
  for (const t of templates) {
    if (t.origin === 'generated') continue;
    const key = t.category?.trim().toLowerCase() || OTHER;
    const list = buckets.get(key);
    if (list) list.push(t);
    else buckets.set(key, [t]);
  }
  const unknown = [...buckets.keys()].filter((k) => k !== OTHER && !known.includes(k)).sort();
  const order = [...known.filter((k) => buckets.has(k)), ...unknown, ...(buckets.has(OTHER) ? [OTHER] : [])];
  const groups = order.map((key) => ({
    key,
    label: key === OTHER ? 'Other' : titleCase(key),
    items: buckets.get(key)!,
  }));
  return yours.length ? [{ key: YOURS, label: 'Your templates', items: yours }, ...groups] : groups;
}

/** Group keys used inside element ids (the internal keys start with a NUL). */
const safeKey = (key: string) => key.replace(/\u0000/g, '_');

function matches(t: TemplateDefinition, q: string): boolean {
  return [t.name, t.description, t.category ?? ''].some((s) => s.toLowerCase().includes(q));
}

export function TemplateList({ templates, activeId, onSelect, onGenerate, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchId = useId();
  const headId = useId();

  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () => groupTemplates(q ? templates.filter((t) => matches(t, q)) : templates),
    [templates, q],
  );
  const visible = useMemo(() => groups.flatMap((g) => g.items.map((t) => t.id)), [groups]);

  // Roving tabindex: the last focused item, else the selected one, else the first visible.
  const rovingId =
    focusId && visible.includes(focusId) ? focusId : visible.includes(activeId) ? activeId : visible[0];

  // Bring the selected template into view on first mount (it may be persisted far down the list).
  useEffect(() => {
    itemRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest' });
    // Only on mount.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const focusItem = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    itemRefs.current.get(id)?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const id = target.dataset.templateId;
    if (!id) return;
    const i = visible.indexOf(id);
    let next: string | undefined;
    switch (e.key) {
      case 'ArrowDown':
        next = visible[Math.min(visible.length - 1, i + 1)];
        break;
      case 'ArrowUp':
        if (i === 0) {
          e.preventDefault();
          inputRef.current?.focus();
          return;
        }
        next = visible[Math.max(0, i - 1)];
        break;
      case 'Home':
        next = visible[0];
        break;
      case 'End':
        next = visible[visible.length - 1];
        break;
      case 'Delete':
        if (templates.find((t) => t.id === id)?.origin === 'generated') {
          e.preventDefault();
          onDelete(id);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    focusItem(next);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    } else if (e.key === 'ArrowDown' && visible.length > 0) {
      e.preventDefault();
      focusItem(rovingId);
    }
  };

  const clear = () => {
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <nav className="templates" aria-label="Templates">
      <div className="templates-search">
        <button type="button" className="btn gen-open" onClick={onGenerate}>
          <SparklesIcon />
          Generate template
        </button>
        <label className="sr-only" htmlFor={searchId}>
          Search templates
        </label>
        <input
          ref={inputRef}
          id={searchId}
          className="input templates-search-input"
          type="search"
          placeholder="Search…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </div>
      <div className="templates-scroll" onKeyDown={onListKey}>
        {groups.length === 0 ? (
          <div className="templates-empty" role="status">
            <p className="templates-empty-title">No templates match</p>
            <button type="button" className="btn" onClick={clear}>
              Clear search
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="tgroup" aria-labelledby={`${headId}-${safeKey(g.key)}`}>
              <h3 className="tgroup-head" id={`${headId}-${safeKey(g.key)}`}>
                {g.label}
              </h3>
              <ul>
                {g.items.map((t) => {
                  const s = t.defaultSettings;
                  const generated = t.origin === 'generated';
                  return (
                    <li key={t.id} className={generated ? 'gen-item' : undefined}>
                      <button
                        type="button"
                        className="template-item"
                        data-template-id={t.id}
                        ref={(el) => {
                          if (el) itemRefs.current.set(t.id, el);
                          else itemRefs.current.delete(t.id);
                        }}
                        tabIndex={t.id === rovingId ? 0 : -1}
                        title={t.description}
                        aria-current={t.id === activeId ? 'true' : undefined}
                        onFocus={() => setFocusId(t.id)}
                        onClick={() => onSelect(t.id)}
                      >
                        <TemplateThumb template={t} />
                        <span className="template-text">
                          <span className="template-name">
                            {t.name}
                            {generated && isDraft(t.id) ? <span className="gen-tag">Draft</span> : null}
                          </span>
                          <span className="template-meta">
                            {s.width}×{s.height} · {s.fps} fps · {formatSeconds(s.durationFrames, s.fps)}
                          </span>
                        </span>
                      </button>
                      {generated ? (
                        <button
                          type="button"
                          className="btn icon gen-delete"
                          aria-label={`Delete ${t.name}`}
                          title="Delete"
                          tabIndex={t.id === rovingId ? 0 : -1}
                          onClick={() => onDelete(t.id)}
                        >
                          <TrashIcon />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
