/**
 * Making a sweep, which is what the course's convergence chapters (8.2-8.5, 6.3.6) consist of.
 *
 * A sweep is built *from a calculation*, not from scratch, because that is how the question is
 * actually asked: here is a run that works, now vary one number and see where the energy stops
 * moving. So the chosen calculation supplies the backend and every other parameter value, and
 * what this form adds is which parameter to vary and over which values.
 *
 * `Continue each point from this calculation` is the course's own distinction, and it changes the
 * answer, not just the cost: a cutoff sweep restarted from one converged reference (ch. 8.2)
 * measures the cutoff alone, while independent runs (ch. 8.3) each converge on their own.
 */
import { useEffect, useState } from 'react';

import { api, type Calculation, type ParameterSpec } from '../api/client';
import { useCalculationStore } from '../state/calculationStore';

/**
 * Parameter types a sweep can vary: a curve needs a number on its x axis. The names are the
 * schema's own (`schemas/engine.py`: integer, number, boolean, string, enum, vector, text).
 */
const NUMERIC = new Set(['integer', 'number']);

/**
 * The values to sweep, from a comma- or space-separated list, or from `from:to:step`.
 *
 * Two spellings because both are natural: the course's cutoff sweep is a list of eight numbers it
 * chose, and its volume scan is a regular range.
 */
export function parseValues(text: string): number[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p.trim()));
    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return [];
    const [from, to, step] = parts as [number, number, number];
    if (!(step > 0) || to < from) return [];
    const out: number[] = [];
    const n = Math.floor((to - from) / step + 1e-9);
    for (let i = 0; i <= n; i++) out.push(Number((from + i * step).toFixed(6)));
    return out;
  }
  const values = trimmed
    .split(/[,\s]+/)
    .filter((p) => p !== '')
    .map((p) => Number(p));
  return values.some((v) => !Number.isFinite(v)) ? [] : values;
}

/** Parameters of a schema a sweep could vary, in the order the schema lists them. */
export function numericParameters(
  sections: { parameters?: ParameterSpec[] }[] | undefined,
): ParameterSpec[] {
  return (sections ?? []).flatMap((s) => (s.parameters ?? []).filter((p) => NUMERIC.has(p.type)));
}

export function NewSweep({
  calculations,
  onCreated,
  onError,
}: {
  calculations: Calculation[];
  onCreated: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const loadSchema = useCalculationStore((s) => s.loadSchema);
  const schemas = useCalculationStore((s) => s.schemas);

  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState('');
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = calculations.find((c) => c.id === fromId) ?? null;
  const schema = base ? schemas[base.backend_id] : undefined;
  const parameters = numericParameters(schema?.sections);
  const parameter = parameters.find((p) => p.key === key) ?? null;
  const values = parseValues(text);

  useEffect(() => {
    if (!open || calculations.length === 0) return;
    setFromId((current) =>
      calculations.some((c) => c.id === current) ? current : calculations[0]!.id,
    );
  }, [open, calculations]);

  useEffect(() => {
    if (!base) return;
    loadSchema(base.backend_id).catch((e: Error) => onError(e.message));
  }, [base, loadSchema, onError]);

  useEffect(() => {
    // a parameter of the previous backend's schema is not one of this one's
    setKey((current) =>
      parameters.some((p) => p.key === current) ? current : (parameters[0]?.key ?? ''),
    );
  }, [parameters]);

  const create = async (): Promise<void> => {
    setError(null);
    if (!base || !parameter) return;
    if (values.length < 2) {
      setError('give at least two values: "20 30 40 50" or "from:to:step"');
      return;
    }
    setBusy(true);
    try {
      await api.sweeps.create({
        structure_id: base.structure_id,
        spec: {
          name: name.trim() || `${base.name} vs ${parameter.label}`,
          backend_id: base.backend_id,
          label: parameter.label,
          unit: parameter.unit ?? null,
          key: parameter.key,
          base_values: base.values ?? {},
          restart_from: restart ? base.id : null,
          points: values.map((v) => ({ x: v, values: { [parameter.key]: v } })),
        },
      });
      setOpen(false);
      setText('');
      setName('');
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="button-row">
        <button onClick={() => setOpen(true)} disabled={calculations.length === 0}>
          New sweep…
        </button>
        {calculations.length === 0 && (
          <span className="muted">
            A sweep varies one parameter of an existing calculation, so set one up first.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="new-sweep">
      <h4>New sweep</h4>
      <div className="form-row">
        <label htmlFor="new-sweep-from">Vary a parameter of</label>
        <select id="new-sweep-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
          {calculations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.backend_id})
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="new-sweep-key">Parameter</label>
        <select id="new-sweep-key" value={key} onChange={(e) => setKey(e.target.value)}>
          {parameters.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
              {p.unit ? ` [${p.unit}]` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="new-sweep-values">Values</label>
        <input
          id="new-sweep-values"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="20 30 40 50, or 20:50:10"
        />
      </div>
      <p className="muted">
        {values.length >= 2
          ? `${values.length} points: ${values.slice(0, 8).join(', ')}${values.length > 8 ? ' …' : ''}`
          : 'A list separated by commas or spaces, or from:to:step.'}
        {parameter?.default !== undefined && parameter?.default !== null && (
          <> Present value {String(base?.values?.[parameter.key] ?? parameter.default)}.</>
        )}
      </p>
      <div className="form-row">
        <label htmlFor="new-sweep-name">Name</label>
        <input
          id="new-sweep-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={parameter ? `${base?.name ?? ''} vs ${parameter.label}` : ''}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />
        Continue each point from this calculation
      </label>
      <p className="muted">
        Restarted from one converged run, a sweep measures the parameter alone (the course does this
        for the wave-function cutoff); left off, every point converges on its own, which is what a
        density-cutoff or cell-size scan needs.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button
          className="primary"
          onClick={() => void create()}
          disabled={busy || !parameter || values.length < 2}
        >
          {busy ? 'Creating…' : 'Create sweep'}
        </button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
