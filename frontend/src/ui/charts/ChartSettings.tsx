/**
 * The display controls for one chart: axis ranges, a log axis, markers, line weight, legend.
 *
 * Folded away behind a toggle, because a panel of sliders above every chart is worse than no
 * controls at all. Settings live in `chartSettingsStore` keyed by the chart, so a chart looks the
 * way it was left after a tab switch or a reload.
 */
import { useState } from 'react';

import {
  DEFAULT_CHART_SETTINGS,
  useChartSettingsStore,
  type ChartSettings as Settings,
} from '../../state/chartSettingsStore';

/** A number field that treats an empty string as "from the data" rather than as zero. */
function LimitInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}): React.ReactElement {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        step="any"
        placeholder="auto"
        value={value === null ? '' : value}
        onChange={(e) => {
          const text = e.target.value.trim();
          onChange(text === '' ? null : Number(text));
        }}
      />
    </>
  );
}

export function ChartSettingsPanel({
  chartId,
  allowLogY,
}: {
  chartId: string;
  allowLogY: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const settings = useChartSettingsStore((s) => s.byChart[chartId] ?? DEFAULT_CHART_SETTINGS);
  const update = useChartSettingsStore((s) => s.set);
  const reset = useChartSettingsStore((s) => s.reset);
  const patch = (p: Partial<Settings>): void => update(chartId, p);

  const changed = Object.entries(settings).some(
    ([k, v]) => v !== DEFAULT_CHART_SETTINGS[k as keyof Settings],
  );

  return (
    <div className="chart-settings">
      <button
        className="chart-settings-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Axis ranges, log scale, markers"
      >
        {open ? '▾' : '▸'} Graph{changed && ' *'}
      </button>
      {open && (
        <div className="chart-settings-body">
          <div className="form-grid">
            <LimitInput
              id={`${chartId}-xmin`}
              label="x from"
              value={settings.xMin}
              onChange={(v) => patch({ xMin: v })}
            />
            <LimitInput
              id={`${chartId}-xmax`}
              label="x to"
              value={settings.xMax}
              onChange={(v) => patch({ xMax: v })}
            />
            <LimitInput
              id={`${chartId}-ymin`}
              label="y from"
              value={settings.yMin}
              onChange={(v) => patch({ yMin: v })}
            />
            <LimitInput
              id={`${chartId}-ymax`}
              label="y to"
              value={settings.yMax}
              onChange={(v) => patch({ yMax: v })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.markers}
              onChange={(e) => patch({ markers: e.target.checked })}
            />
            Mark each point
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.legend}
              onChange={(e) => patch({ legend: e.target.checked })}
            />
            Legend
          </label>
          {allowLogY && (
            <label className="check">
              <input
                type="checkbox"
                checked={settings.logY}
                onChange={(e) => patch({ logY: e.target.checked })}
              />
              Logarithmic y axis
            </label>
          )}
          <div className="form-row">
            <label htmlFor={`${chartId}-lw`}>line {settings.lineWidth.toFixed(1)}</label>
            <input
              id={`${chartId}-lw`}
              type="range"
              min="0.5"
              max="4"
              step="0.5"
              value={settings.lineWidth}
              onChange={(e) => patch({ lineWidth: Number(e.target.value) })}
            />
          </div>
          <div className="button-row">
            <button onClick={() => reset(chartId)} disabled={!changed}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
