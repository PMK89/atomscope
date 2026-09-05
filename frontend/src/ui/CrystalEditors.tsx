/** Small stateful sub-editors of the Crystal panel (local text state, apply/reset). */
import { useState } from 'react';
import {
  formatMatrix,
  parseMatrix,
  parseRepeat,
  type CellParameters,
  type Mat3,
} from '../model/crystal';

export type Cellpar = [number, number, number, number, number, number];
const PARAM_KEYS: (keyof CellParameters)[] = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
const PARAM_LABELS: Record<keyof CellParameters, string> = {
  a: 'a (Å)',
  b: 'b (Å)',
  c: 'c (Å)',
  alpha: 'α (°)',
  beta: 'β (°)',
  gamma: 'γ (°)',
};

function paramsToText(p: CellParameters): Record<keyof CellParameters, string> {
  return Object.fromEntries(PARAM_KEYS.map((k) => [k, p[k].toFixed(4)])) as Record<
    keyof CellParameters,
    string
  >;
}

export function ParametersEditor({
  params,
  onApply,
}: {
  params: CellParameters;
  onApply: (p: Cellpar) => void;
}): JSX.Element {
  const [text, setText] = useState(paramsToText(params));
  const apply = (): void => {
    const nums = PARAM_KEYS.map((k) => Number(text[k]));
    if (nums.some((n) => !Number.isFinite(n))) return;
    onApply(nums as Cellpar);
  };
  return (
    <>
      <div className="form-vector crystal-params">
        {PARAM_KEYS.map((k) => (
          <label key={k} className="crystal-param">
            <span className="form-unit">{PARAM_LABELS[k]}</span>
            <input
              aria-label={`Cell ${k}`}
              value={text[k]}
              onChange={(e) => setText({ ...text, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="button-row">
        <button className="primary" onClick={apply}>
          Apply parameters
        </button>
        <button onClick={() => setText(paramsToText(params))}>Reset</button>
      </div>
    </>
  );
}

export function MatrixEditor({
  matrix,
  onApply,
}: {
  matrix: Mat3;
  onApply: (m: Mat3) => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  return (
    <TextEditor
      label="Cell matrix"
      initial={formatMatrix(matrix)}
      rows={3}
      error={error}
      onApply={(text) => {
        try {
          onApply(parseMatrix(text));
          setError(null);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    />
  );
}

export function TextEditor({
  label,
  initial,
  rows,
  error,
  onApply,
}: {
  label: string;
  initial: string;
  rows: number;
  error?: string | null;
  onApply: (text: string) => void;
}): JSX.Element {
  const [text, setText] = useState(initial);
  return (
    <>
      <textarea
        aria-label={label}
        rows={rows}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button className="primary" onClick={() => onApply(text)}>
          Apply {label.toLowerCase()}
        </button>
        <button onClick={() => setText(initial)}>Reset</button>
      </div>
    </>
  );
}

export function RepeatEditor({
  value,
  onApply,
}: {
  value: [number, number, number];
  onApply: (r: [number, number, number]) => void;
}): JSX.Element {
  const [text, setText] = useState<[string, string, string]>(
    value.map(String) as [string, string, string],
  );
  return (
    <div className="form-row">
      <label>Cell repeats</label>
      <div className="form-vector">
        {(['A', 'B', 'C'] as const).map((axis, i) => (
          <input
            key={axis}
            aria-label={`Repeat ${axis}`}
            value={text[i]}
            onChange={(e) => {
              const next = [...text] as [string, string, string];
              next[i] = e.target.value;
              setText(next);
              try {
                onApply(parseRepeat(next));
              } catch {
                /* incomplete input: keep the previous repeats until it parses */
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
