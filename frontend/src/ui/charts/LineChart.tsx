/**
 * Minimal inline-SVG line chart: axes, nice ticks, several series, optional log y axis,
 * vertical markers (Fermi level, high-symmetry points) and a hover readout.
 */
import { useId, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_CHART_SETTINGS,
  canLogY,
  useChartSettingsStore,
} from '../../state/chartSettingsStore';
import { ChartSettingsPanel } from './ChartSettings';
import { areaPath, areaSpans } from './area';
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
  /**
   * Legend entry this series belongs to. Series sharing a group produce a single entry captioned
   * by the group, so a family too numerous to name one by one can still be named: twenty band
   * curves in three occupation classes make three entries. A group therefore overrides `quiet`.
   */
  legendGroup?: string;
  /**
   * Lower edge of a filled area, same length as `y`. Present means "fill between `baseline` and
   * `y`" -- a stacked density of states passes the running cumulative total here.
   */
  baseline?: number[];
  /**
   * x at which a filled area drops to half opacity. A stacked DOS puts the Fermi level here, so
   * the occupied side reads solid and the empty side faint, as the course's figures draw it.
   */
  fillSplitX?: number;
}

export interface ChartMarker {
  x: number;
  label?: string;
  color?: string;
}

/** A horizontal line at `y`, labelled at the right edge: the Fermi level of a band structure. */
export interface ChartYMarker {
  y: number;
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

/**
 * A domain with only the ends the user actually fixed replaced.
 *
 * Returns `undefined` when nothing is fixed and the caller passed no domain either, which is the
 * signal to derive the whole range from the data.
 */
function mergeEnds(
  base: Domain | undefined,
  data: Domain | null,
  lo: number | null,
  hi: number | null,
): Domain | undefined {
  if (lo === null && hi === null) return base;
  const from = base ?? data ?? [0, 1];
  return [lo ?? from[0], hi ?? from[1]];
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
  yMarkers?: ChartYMarker[];
  /** draw a horizontal line at y = 0 */
  zeroLine?: boolean;
  title?: string;
  /** draw the x axis from high to low (IR wavenumbers, NMR shifts) */
  xReversed?: boolean;
  /** vertical lines from y = 0, for stick spectra; cheaper than one series per line */
  sticks?: ChartStick[];
  /** called with the data-space x of a click inside the plot area */
  onPick?: (x: number) => void;
  /**
   * Give the chart a stable id and it grows a "Graph" control: axis ranges, a log axis, markers,
   * line weight and the legend, remembered per chart. What the caller passes as `logY`,
   * `xDomain` and `yDomain` becomes the default the controls start from.
   */
  settingsId?: string;
}

const MARGIN = { top: 12, right: 12, bottom: 34, left: 52 };

export function LineChart({
  series,
  width = 320,
  height = 200,
  xLabel,
  yLabel,
  logY: logYProp = false,
  yDomain: yDomainProp,
  xDomain: xDomainProp,
  xTicks,
  markers = [],
  yMarkers = [],
  zeroLine = false,
  title,
  xReversed = false,
  sticks = [],
  onPick,
  settingsId,
}: LineChartProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const settings = useChartSettingsStore((s) =>
    settingsId === undefined
      ? DEFAULT_CHART_SETTINGS
      : (s.byChart[settingsId] ?? DEFAULT_CHART_SETTINGS),
  );
  const logY = settings.logY || logYProp;

  const drawn = useMemo(
    () => (logY ? series.map((s) => ({ ...s, ...positiveOnly(s.x, s.y) })) : series),
    [series, logY],
  );
  const filled = useMemo(() => drawn.filter((s) => s.baseline !== undefined), [drawn]);
  // Axis ranges narrower than the data are a frame, not a filter (see `mergeEnds`): the points
  // outside stay in the polyline so its slope at the edge is the real one, and this clip is what
  // keeps them from being drawn over the axes and the tick labels.
  const clipId = useId();
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
  // The stored settings win over the props, which stand in as the defaults they start from. A
  // limit left empty means "from the data", so only the ends actually set are overridden.
  const xDomain = mergeEnds(xDomainProp, extent(xs), settings.xMin, settings.xMax);
  const yDomain = mergeEnds(yDomainProp, extent(ys), settings.yMin, settings.yMax);

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

  // `quiet` exists for series there is no point naming one by one -- twenty band curves, say.
  // A `legendGroup` names such a family instead, and one entry stands for all of its members.
  const named = ((): { key: string; label: string; color: string }[] => {
    const out: { key: string; label: string; color: string }[] = [];
    const seen = new Set<string>();
    for (const s of drawn) {
      if (!s.legendGroup && (s.quiet || !s.label)) continue;
      const key = s.legendGroup ?? s.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: s.legendGroup ?? s.label, color: s.color });
    }
    return out;
  })();

  return (
    <>
      {settingsId !== undefined && (
        <ChartSettingsPanel chartId={settingsId} allowLogY={!logYProp && canLogY(drawn)} />
      )}
      {settings.legend && named.length > 1 && (
        <p className="chart-legend">
          {named.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </p>
      )}
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
        {yMarkers
          .filter((m) => m.y >= yDom[0] && m.y <= yDom[1])
          .map((m, i) => (
            <g key={`ym${i}`}>
              <line
                x1={plot.x0}
                x2={plot.x1}
                y1={sy(m.y)}
                y2={sy(m.y)}
                className="chart-marker"
                style={m.color ? { stroke: m.color } : undefined}
              />
              {m.label && (
                <text x={plot.x1 - 3} y={sy(m.y) - 3} textAnchor="end" className="chart-tick">
                  {m.label}
                </text>
              )}
            </g>
          ))}
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
        <clipPath id={clipId}>
          <rect x={plot.x0} y={plot.y1} width={plot.x1 - plot.x0} height={plot.y0 - plot.y1} />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
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
          {filled.flatMap((s) =>
            areaSpans(s.x, s.y, s.baseline!, s.fillSplitX).map((span, i) => (
              <path
                key={`${s.id}-fill${i}`}
                d={areaPath(span, sx, sy)}
                fill={s.color}
                fillOpacity={span.solid ? 0.85 : 0.35}
                stroke="none"
              />
            )),
          )}
          {drawn.map((s) => (
            <polyline
              key={s.id}
              fill="none"
              stroke={s.color}
              strokeWidth={settings.lineWidth}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              points={s.x.map((x, i) => `${sx(x).toFixed(1)},${sy(s.y[i]!).toFixed(1)}`).join(' ')}
            />
          ))}
          {settings.markers &&
            drawn.flatMap((s) =>
              s.x.map((x, i) => (
                <circle
                  key={`${s.id}-m${i}`}
                  cx={sx(x)}
                  cy={sy(s.y[i]!)}
                  r={Math.max(1.2, settings.lineWidth)}
                  fill={s.color}
                />
              )),
            )}
        </g>
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
            <line
              x1={sx(hover)}
              x2={sx(hover)}
              y1={plot.y0}
              y2={plot.y1}
              className="chart-cursor"
            />
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
    </>
  );
}
