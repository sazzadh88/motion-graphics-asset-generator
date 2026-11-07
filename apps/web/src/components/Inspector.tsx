import { useId } from 'react';
import type { Dispatch } from 'react';
import { LIMITS, SIZE_PRESETS, defaultPayload } from '@mg/engine';
import type { ParamDef, RenderJobPayload, TemplateDefinition } from '@mg/engine';
import type { Action } from '../state/store';
import { NumField } from './NumField';
import { ParamControl } from './ParamControl';
import { Switch } from './Switch';

interface Props {
  template: TemplateDefinition;
  payload: RenderJobPayload;
  dispatch: Dispatch<Action>;
}

function groupParams(params: ParamDef[]): [string, ParamDef[]][] {
  const groups = new Map<string, ParamDef[]>();
  for (const p of params) {
    const g = p.group ?? 'General';
    const list = groups.get(g);
    if (list) list.push(p);
    else groups.set(g, [p]);
  }
  return [...groups.entries()];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toEven = (n: number) => clamp(Math.round(n / 2) * 2, LIMITS.minSize, LIMITS.maxSize);

export function Inspector({ template, payload, dispatch }: Props) {
  const groups = groupParams(template.params);
  return (
    <div className="inspector">
      {groups.map(([name, params]) => (
        <details className="section" key={name} open>
          <summary>{name}</summary>
          <div className="section-body">
            {params.map((def) => (
              <ParamControl
                key={def.key}
                def={def}
                value={payload.assets[def.key]}
                onChange={(value) => dispatch({ type: 'setAsset', key: def.key, value })}
              />
            ))}
          </div>
        </details>
      ))}
      <OutputSection payload={payload} dispatch={dispatch} />
    </div>
  );
}

function OutputSection({ payload, dispatch }: { payload: RenderJobPayload; dispatch: Dispatch<Action> }) {
  const base = useId();
  const { width, height, fps, durationFrames, transparent } = payload.settings;
  const presetIndex = SIZE_PRESETS.findIndex((p) => p.width === width && p.height === height);
  const seconds = Math.round((durationFrames / fps) * 100) / 100;
  const maxSeconds = LIMITS.maxDurationSeconds;

  return (
    <details className="section" open>
      <summary>Output</summary>
      <div className="section-body">
        <div className="field">
          <label className="label" htmlFor={`${base}-preset`}>
            Size preset
          </label>
          <select
            id={`${base}-preset`}
            className="input"
            value={presetIndex >= 0 ? String(presetIndex) : 'custom'}
            onChange={(e) => {
              const p = SIZE_PRESETS[Number(e.target.value)];
              if (p) dispatch({ type: 'setSettings', patch: { width: p.width, height: p.height } });
            }}
          >
            {presetIndex < 0 ? <option value="custom">Custom</option> : null}
            {SIZE_PRESETS.map((p, i) => (
              <option key={p.label} value={String(i)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-pair">
          <div className="field">
            <label className="label" htmlFor={`${base}-w`}>
              Width
            </label>
            <NumField
              id={`${base}-w`}
              value={width}
              min={LIMITS.minSize}
              max={LIMITS.maxSize}
              unit="px"
              onCommit={(n) => dispatch({ type: 'setSettings', patch: { width: toEven(n) } })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${base}-h`}>
              Height
            </label>
            <NumField
              id={`${base}-h`}
              value={height}
              min={LIMITS.minSize}
              max={LIMITS.maxSize}
              unit="px"
              onCommit={(n) => dispatch({ type: 'setSettings', patch: { height: toEven(n) } })}
            />
          </div>
        </div>
        <p className="hint">Sizes snap to even numbers ({LIMITS.minSize}–{LIMITS.maxSize}) for video encoding.</p>
        <div className="field-pair">
          <div className="field">
            <label className="label" htmlFor={`${base}-fps`}>
              Frame rate
            </label>
            <select
              id={`${base}-fps`}
              className="input"
              value={fps}
              onChange={(e) => {
                const next = Number(e.target.value);
                const frames = clamp(Math.round((durationFrames / fps) * next), 1, maxSeconds * next);
                dispatch({ type: 'setSettings', patch: { fps: next, durationFrames: frames } });
              }}
            >
              {LIMITS.fps.map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor={`${base}-dur`}>
              Duration
            </label>
            <NumField
              id={`${base}-dur`}
              value={seconds}
              min={0.1}
              max={maxSeconds}
              unit="s"
              onCommit={(s) =>
                dispatch({
                  type: 'setSettings',
                  patch: { durationFrames: clamp(Math.round(s * fps), 1, maxSeconds * fps) },
                })
              }
            />
          </div>
        </div>
        <p className="hint">
          {durationFrames} frames, max {maxSeconds}s.
        </p>
        <div className="field field-inline">
          <label className="label" htmlFor={`${base}-alpha`}>
            Transparent background
          </label>
          <Switch
            id={`${base}-alpha`}
            checked={transparent}
            onChange={(v) => dispatch({ type: 'setSettings', patch: { transparent: v } })}
          />
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => dispatch({ type: 'applyPayload', payload: defaultPayload(payload.templateId) })}
        >
          Reset to template defaults
        </button>
      </div>
    </details>
  );
}
