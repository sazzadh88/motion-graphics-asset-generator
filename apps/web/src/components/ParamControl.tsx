import { useId, useRef, useState } from 'react';
import type { ParamDef, ParamValue } from '@mg/engine';
import { NumField } from './NumField';
import { Switch } from './Switch';
import { TrashIcon } from './Icons';

interface Props {
  def: ParamDef;
  value: ParamValue | undefined;
  onChange: (value: ParamValue) => void;
}

const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const DEFAULT_MAX_TEXT = 500;

export function ParamControl({ def, value, onChange }: Props) {
  const id = useId();
  const field = (control: React.ReactNode, inline = false) => (
    <div className={inline ? 'field field-inline' : 'field'}>
      <label className="label" htmlFor={id}>
        {def.label}
      </label>
      {control}
      {def.description ? <p className="hint">{def.description}</p> : null}
    </div>
  );

  switch (def.type) {
    case 'text': {
      const v = typeof value === 'string' ? value : def.default;
      const max = def.maxLength ?? DEFAULT_MAX_TEXT;
      return field(
        <>
          {def.multiline ? (
            <textarea
              id={id}
              className="input"
              rows={3}
              maxLength={max}
              value={v}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <input
              id={id}
              className="input"
              type="text"
              maxLength={max}
              value={v}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
          {def.maxLength !== undefined ? (
            <span className="counter">
              {v.length}/{max}
            </span>
          ) : null}
        </>,
      );
    }
    case 'color':
      return field(<ColorControl id={id} value={typeof value === 'string' ? value : def.default} onChange={onChange} />);
    case 'number': {
      const v = typeof value === 'number' ? value : def.default;
      return field(
        <div className="row">
          <input
            className="range"
            type="range"
            aria-label={`${def.label} slider`}
            min={def.min}
            max={def.max}
            step={def.step ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <NumField
            id={id}
            value={v}
            min={def.min}
            max={def.max}
            step={def.step}
            unit={def.unit}
            live
            onCommit={onChange}
          />
        </div>,
      );
    }
    case 'boolean':
      return field(
        <Switch id={id} checked={typeof value === 'boolean' ? value : def.default} onChange={onChange} />,
        true,
      );
    case 'select':
      return field(
        <select
          id={id}
          className="input"
          value={typeof value === 'string' ? value : def.default}
          onChange={(e) => onChange(e.target.value)}
        >
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      );
    case 'image':
      return field(<ImageControl id={id} value={typeof value === 'string' ? value : null} onChange={onChange} />);
  }
}

function ColorControl({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const valid = HEX.test(shown);
  const swatch = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000';
  return (
    <>
      <div className="row">
        <input
          className="color"
          type="color"
          aria-label="Pick color"
          value={swatch}
          onChange={(e) => {
            setDraft(null);
            onChange(e.target.value);
          }}
        />
        <input
          id={id}
          className="input mono"
          type="text"
          spellCheck={false}
          maxLength={9}
          value={shown}
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : `${id}-err`}
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && !v.startsWith('#')) v = `#${v}`;
            setDraft(v);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      {valid ? null : (
        <p className="error" id={`${id}-err`}>
          Use a hex color like #1a2b3c.
        </p>
      )}
    </>
  );
}

const URL_OK = /^(https?:\/\/|data:image\/|blob:)/i;

function ImageControl({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState(false);

  const set = (next: string | null) => {
    if (value && value.startsWith('blob:') && value !== next) URL.revokeObjectURL(value);
    onChange(next);
  };

  const applyUrl = () => {
    const v = urlDraft.trim();
    if (!v) return;
    if (!URL_OK.test(v)) {
      setUrlError(true);
      return;
    }
    setUrlError(false);
    setUrlDraft('');
    set(v);
  };

  return (
    <div className="image-control">
      {value ? (
        <div className="thumb-row">
          <img className="thumb" src={value} alt="" />
          <span className="thumb-name">{value.startsWith('data:') ? 'Embedded image' : value.startsWith('blob:') ? 'Uploaded file' : value}</span>
          <button type="button" className="btn icon" aria-label="Remove image" title="Remove image" onClick={() => set(null)}>
            <TrashIcon />
          </button>
        </div>
      ) : null}
      <input
        ref={fileRef}
        id={id}
        className="visually-hidden-file"
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) set(URL.createObjectURL(file));
          e.target.value = '';
        }}
      />
      <div className="row">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          {value ? 'Replace image' : 'Upload image'}
        </button>
      </div>
      <div className="row">
        <input
          className="input"
          type="url"
          aria-label="Image URL"
          placeholder="Paste image URL, then Enter"
          value={urlDraft}
          aria-invalid={urlError}
          onChange={(e) => {
            setUrlDraft(e.target.value);
            setUrlError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyUrl();
          }}
          onBlur={applyUrl}
        />
      </div>
      {urlError ? <p className="error">Enter an http(s), data: or blob: image URL.</p> : null}
    </div>
  );
}
