/**
 * Minimal inline-SVG line chart: axes, nice ticks, several series, optional log y axis,
 * vertical markers (Fermi level, high-symmetry points) and a hover readout.
 */
import { useMemo, useRef, useState } from 'react';
import {
  extent,
  formatTick,
  niceStep,
  invertScale,
  linearTicks,
  logTicks,
  makeScale,
  nearestIndex,
  padDomain,
  positiveOnly,
  type Domain,
} from './scale';

export interface ChartSeries {
  id: string;
  label: string;
  x: number[];
  y: number[];
  color: string;
  dashed?: boolean;
  /** hide from the legend (e.g. many bands) */
  quiet?: boolean;
}

export interface ChartMarker {
  x: number;
  label?: string;
  color?: string;
}

/** A stick (spectral line) drawn from y = 0 to `y` at `x`. */
export interface ChartStick {
  x: number;
  y: number;
  color?: string;
  /** highlighted (e.g. the mode currently animating) */
  active?: boolean;
}

export interface LineChartProps {
  series: ChartSeries[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  logY?: boolean;
  /** fixed y domain (e.g. symmetric for spin up/down); default from the data */
  yDomain?: Domain;
  xDomain?: Domain;
  /** custom x ticks (band-structure labels); default nice ticks */
  xTicks?: { value: number; label: string }[];
  markers?: ChartMarker[];
  /** draw a horizontal line at y = 0 */
  zeroLine?: boolean;
  title?: string;
  /** draw the x axis from high to low (IR wavenumbers, NMR shifts) */
  xReversed?: boolean;
  /** vertical lines from y = 0, for stick spectra; cheaper than one series per line */
  sticks?: ChartStick[];
  /** called with the data-space x of a click inside the plot area */
  onPick?: (x: number) => void;
}

const MARGIN = { top: 12, right: 12, bottom: 34, left: 52 };

export function LineChart({
  series,
  width = 320,
  height = 200,
  xLabel,
  yLabel,
  logY = false,
  yDomain,
  xDomain,
  xTicks,
  markers = [],
  zeroLine = false,
  title,
  xReversed = false,
  sticks = [],
  onPick,
}: LineChartProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const drawn = useMemo(
    () => (logY ? series.map((s) => ({ ...s, ...positiveOnly(s.x, s.y) })) : series),
    [series, logY],
  );
  const plot = {
    x0: MARGIN.left,
    x1: width - MARGIN.right,
    y0: height - MARGIN.bottom,
    y1: MARGIN.top,
  };
  const xs = drawn.flatMap((s) => s.x).concat(sticks.map((s) => s.x));
  const ys = drawn
    .flatMap((s) => s.y)
    .concat(
      sticks.map((s) => s.y),
      sticks.length ? [0] : [],
    );
  const xd: Domain = xDomain ?? padDomain(extent(xs) ?? [0, 1], 0);
  const yd: Domain = yDomain ?? padDomain(extent(ys) ?? (logY ? [1e-3, 1] : [0, 1]));
  const yDom: Domain = logY && !(yd[0] > 0) ? [Math.max(yd[1] * 1e-6, 1e-12), yd[1] || 1] : yd;
  // a reversed axis flips the pixel range, never the domain: ticks and markers keep working
  const xRange: Domain = xReversed ? [plot.x1, plot.x0] : [plot.x0, plot.x1];
  const sx = makeScale(xd, xRange);
  const sy = makeScale(yDom, [plot.y0, plot.y1], logY);
  const xStep = niceStep(xd[1] - xd[0]);
  const yStep = niceStep(yDom[1] - yDom[0]);
  const xTickList =
    xTicks ?? linearTicks(xd).map((v) => ({ value: v, label: formatTick(v, xStep) }));
  const yTickList = logY ? logTicks(yDom) : linearTicks(yDom);

  const dataX = (e: { clientX: number }): number | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < plot.x0 || px > plot.x1) return null;
    return invertScale(xd, xRange)(px);
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    setHover(dataX(e));
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const x = dataX(e);
    if (x !== null) onPick?.(x);
  };

  const readout =
    hover == null
      ? null
      : drawn
          .filter((s) => !s.quiet && s.x.length > 0)
          .map((s) => {
            const i = nearestIndex(s.x, hover);
            return { s, x: s.x[i]!, y: s.y[i]! };
          });

  return (
    <svg
      ref={svgRef}
      className="line-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? yLabel ?? 'chart'}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onClick={onPick ? onClick : undefined}
      style={onPick ? { cursor: 'crosshair' } : undefined}
    >
      {title && (
        <text x={plot.x0} y={MARGIN.top - 2} className="chart-title">
          {title}
        </text>
      )}
      <rect
        x={plot.x0}
        y={plot.y1}
        width={plot.x1 - plot.x0}
        height={plot.y0 - plot.y1}
        className="chart-plot"
      />
      {yTickList.map((v) => (
        <g key={`y${v}`}>
          <line x1={plot.x0} x2={plot.x1} y1={sy(v)} y2={sy(v)} className="chart-grid" />
          <text x={plot.x0 - 4} y={sy(v) + 3} textAnchor="end" className="chart-tick">
            {logY ? formatTick(v) : formatTick(v, yStep)}
          </text>
        </g>
      ))}
      {xTickList.map((t, i) => (
        <g key={`x${i}`}>
          <line
            x1={sx(t.value)}
            x2={sx(t.value)}
            y1={plot.y0}
            y2={xTicks ? plot.y1 : plot.y0 + 4}
            className={xTicks ? 'chart-grid' : 'chart-axis'}
          />
          <text x={sx(t.value)} y={plot.y0 + 14} textAnchor="middle" className="chart-tick">
            {t.label}
          </text>
        </g>
      ))}
      {zeroLine && !logY && yDom[0] < 0 && yDom[1] > 0 && (
        <line x1={plot.x0} x2={plot.x1} y1={sy(0)} y2={sy(0)} className="chart-axis" />
      )}
      {markers
        .filter((m) => m.x >= xd[0] && m.x <= xd[1])
        .map((m, i) => (
          <g key={`m${i}`}>
            <line
              x1={sx(m.x)}
              x2={sx(m.x)}
              y1={plot.y0}
              y2={plot.y1}
              className="chart-marker"
              style={m.color ? { stroke: m.color } : undefined}
            />
            {m.label && (
              <text x={sx(m.x) + 3} y={plot.y1 + 10} className="chart-tick">
                {m.label}
              </text>
            )}
          </g>
        ))}
      {sticks.map((s, i) => (
        <line
          key={`stick${i}`}
          x1={sx(s.x)}
          x2={sx(s.x)}
          y1={sy(Math.max(yDom[0], Math.min(0, yDom[1])))}
          y2={sy(s.y)}
          className={s.active ? 'chart-stick active' : 'chart-stick'}
          style={s.color ? { stroke: s.color } : undefined}
        />
      ))}
      {drawn.map((s) => (
        <polyline
          key={s.id}
          fill="none"
          stroke={s.color}
          strokeWidth={1.5}
          strokeDasharray={s.dashed ? '4 3' : undefined}
          points={s.x.map((x, i) => `${sx(x).toFixed(1)},${sy(s.y[i]!).toFixed(1)}`).join(' ')}
        />
      ))}
      <line x1={plot.x0} x2={plot.x1} y1={plot.y0} y2={plot.y0} className="chart-axis" />
      <line x1={plot.x0} x2={plot.x0} y1={plot.y0} y2={plot.y1} className="chart-axis" />
      {xLabel && (
        <text
          x={(plot.x0 + plot.x1) / 2}
          y={height - 4}
          textAnchor="middle"
          className="chart-label"
        >
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text
          transform={`translate(10 ${(plot.y0 + plot.y1) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="chart-label"
        >
          {yLabel}
        </text>
      )}
      {hover != null && readout && readout.length > 0 && (
        <g className="chart-hover">
          <line x1={sx(hover)} x2={sx(hover)} y1={plot.y0} y2={plot.y1} className="chart-cursor" />
          {readout.map((r, i) => (
            <text
              key={r.s.id}
              x={plot.x1 - 4}
              y={plot.y1 + 12 + i * 12}
              textAnchor="end"
              className="chart-readout"
              fill={r.s.color}
            >
              {r.s.label}: {formatTick(r.y)} @ {formatTick(r.x)}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}
