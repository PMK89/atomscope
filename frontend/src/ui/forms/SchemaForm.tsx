/**
 * Renders a ParameterSchema as a form. Purely data-driven: every backend gets its form from
 * the same component. Validation messages come from the backend's ValidationReport.
 */
import { useState } from 'react';
import type {
  ParameterSchema,
  ParameterSpec,
  ParameterValues,
  ValidationReport,
} from '../../api/client';
import { isVisible } from '../../model/schema';

interface Props {
  schema: ParameterSchema;
  values: ParameterValues;
  onChange: (values: ParameterValues) => void;
  report?: ValidationReport | null | undefined;
  disabled?: boolean | undefined;
}

function Field({
  spec,
  value,
  onChange,
  error,
  disabled,
}: {
  spec: ParameterSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
}): JSX.Element {
  const id = `param-${spec.key}`;
  const unit = spec.unit ? <span className="form-unit">{spec.unit}</span> : null;
  let input: JSX.Element;
  switch (spec.type) {
    case 'boolean':
      input = (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;
    case 'enum':
      input = (
        <select
          id={id}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => {
            const choice = (spec.choices ?? []).find((c) => String(c.value) === e.target.value);
            onChange(choice ? choice.value : e.target.value);
          }}
        >
          {(spec.choices ?? []).map((c) => (
            <option key={String(c.value)} value={String(c.value)} title={c.help}>
              {c.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'integer':
    case 'number':
      input = (
        <input
          id={id}
          type="number"
          step={spec.type === 'integer' ? 1 : 'any'}
          min={spec.minimum ?? undefined}
          max={spec.maximum ?? undefined}
          value={value === undefined || value === null ? '' : String(value)}
          disabled={disabled}
          onChange={(e) => {
            const t = e.target.value;
            if (t === '') return onChange(null);
            const n = spec.type === 'integer' ? parseInt(t, 10) : parseFloat(t);
            onChange(Number.isNaN(n) ? t : n);
          }}
        />
      );
      break;
    case 'vector': {
      const arr = Array.isArray(value) ? (value as unknown[]) : Array(spec.length ?? 3).fill('');
      input = (
        <span className="form-vector">
          {arr.map((x, i) => (
            <input
              key={i}
              type="number"
              step={spec.integer_vector ? 1 : 'any'}
              value={x === null || x === undefined ? '' : String(x)}
              disabled={disabled}
              aria-label={`${spec.label} ${i + 1}`}
              onChange={(e) => {
                const next = [...arr];
                const n = spec.integer_vector
                  ? parseInt(e.target.value, 10)
                  : parseFloat(e.target.value);
                next[i] = Number.isNaN(n) ? e.target.value : n;
                onChange(next);
              }}
            />
          ))}
        </span>
      );
      break;
    }
    case 'text':
      input = (
        <textarea
          id={id}
          rows={4}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    default:
      input = (
        <input
          id={id}
          type="text"
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div className={error ? 'form-row has-error' : 'form-row'} title={spec.help}>
      <label htmlFor={id}>
        {spec.label}
        {spec.required && <span className="form-required">*</span>}
      </label>
      <div className="form-control">
        {input}
        {unit}
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}

export function SchemaForm({ schema, values, onChange, report, disabled }: Props): JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const errors = new Map<string, string>();
  for (const issue of report?.issues ?? []) if (issue.key) errors.set(issue.key, issue.message);
  const general = (report?.issues ?? []).filter((i) => !i.key);
  return (
    <form className="schema-form" onSubmit={(e) => e.preventDefault()}>
      <label className="form-advanced-toggle">
        <input
          type="checkbox"
          checked={showAdvanced}
          onChange={(e) => setShowAdvanced(e.target.checked)}
        />
        Show advanced options
      </label>
      {general.map((i) => (
        <div key={i.message} className="form-error">
          {i.message}
        </div>
      ))}
      {schema.sections.map((section) => {
        if (section.advanced && !showAdvanced) return null;
        const visible = (section.parameters ?? []).filter(
          (p) => isVisible(p, values) && (showAdvanced || !p.advanced),
        );
        if (visible.length === 0) return null;
        return (
          <fieldset key={section.id} className="form-section">
            <legend title={section.help}>{section.label}</legend>
            {visible.map((spec) => (
              <Field
                key={spec.key}
                spec={spec}
                value={values[spec.key]}
                error={errors.get(spec.key)}
                disabled={disabled}
                onChange={(v) => onChange({ ...values, [spec.key]: v })}
              />
            ))}
          </fieldset>
        );
      })}
    </form>
  );
}
