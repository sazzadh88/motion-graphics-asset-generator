import { useId, useRef, useState } from 'react';
import type { ParamDef, ParamValue } from '@mg/engine';
import { NumField } from './NumField';
import { Switch } from './Switch';
import { TrashIcon } from './Icons';
import { ApiRequestError, describeError, uploadAsset } from '../api/client';

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

const URL_OK = /^(https?:\/\/|data:image\/)/i;
const ASSET_URL = /^\/api\/assets\/[A-Za-z0-9_-]{8,64}$/;
const MAX_UPLOAD = 10 * 1024 * 1024;

function uploadMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 415) return 'Unsupported file type. Use a PNG, JPEG, WebP or GIF image.';
    if (e.status === 413) return 'That image is too large. The limit is 10 MB.';
  }
  return describeError(e);
}

function ImageControl({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploaded = value !== null && ASSET_URL.test(value);

  const upload = async (file: File) => {
    setUploadError(null);
    if (file.size > MAX_UPLOAD) {
      setUploadError('That image is too large. The limit is 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const asset = await uploadAsset(file);
      onChange(asset.url);
    } catch (e) {
      setUploadError(uploadMessage(e));
    } finally {
      setUploading(false);
    }
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
    setUploadError(null);
    onChange(v);
  };

  return (
    <div className="image-control">
      {value ? (
        <div className="thumb-row">
          <img className="thumb" src={value} alt="" />
          <span className="thumb-name">
            {uploaded ? 'Uploaded image' : value.startsWith('data:') ? 'Embedded image' : value}
          </span>
          <button
            type="button"
            className="btn icon"
            aria-label="Remove image"
            title="Remove image"
            disabled={uploading}
            onClick={() => {
              setUploadError(null);
              onChange(null);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      ) : null}
      <input
        ref={fileRef}
        id={id}
        className="visually-hidden-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <div className="row">
        <button type="button" className="btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
        </button>
      </div>
      {uploading ? (
        <p className="hint" role="status">
          Uploading image…
        </p>
      ) : null}
      {uploadError ? (
        <p className="error" role="alert">
          {uploadError}
        </p>
      ) : null}
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
      {urlError ? <p className="error">Enter an http(s) or data: image URL.</p> : null}
      {value && !uploaded ? (
        <p className="hint">Pasted URLs work for preview only. Upload the image to include it in a video export.</p>
      ) : null}
    </div>
  );
}
