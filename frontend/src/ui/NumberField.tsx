import { useEffect, useState } from 'react';

/** Numeric input that keeps local text while typing and commits on Enter / blur. */
export function NumberField({
  value,
  onCommit,
  step = 0.01,
  digits = 4,
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  digits?: number;
  label?: string;
}): JSX.Element {
  const [text, setText] = useState(value.toFixed(digits));
  useEffect(() => setText(value.toFixed(digits)), [value, digits]);
  const commit = (): void => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(value.toFixed(digits));
  };
  return (
    <input
      type="number"
      step={step}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
