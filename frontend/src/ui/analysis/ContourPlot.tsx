/**
 * A field cut drawn as a filled contour, the way the course's ch. 3 pictures are drawn.
 *
 * Filled first (one rectangle per cell, coloured by value), then the isolines on top -- which is
 * what gnuplot's `set pm3d` + `set contour` produce and what `asecppaw`'s `contourPlot` does with
 * matplotlib's `contourf` + `contour`.
 */
import { useMemo } from 'react';

import type { PlaneField } from '../../api/client';
import { contourLevels, cppawColor, marchingSquares } from '../charts/contour';

const MARGIN = { top: 8, right: 8, bottom: 26, left: 34 };

/**
 * How field values map onto the colour scale.
 *
 * `linear` is the field's own range. `symmetric` centres it on zero, which is what a signed
 * wavefunction needs -- an off-centre scale makes its two lobes look unlike each other, and
 * `asecppaw`'s `contourPlot` normalises symmetrically for exactly that reason. `log` is for a
 * density: it has a cusp at every nucleus, so on a linear scale the whole picture is one bright
 * point and the bonds -- the part worth looking at -- are flat dark blue.
 */
export type ContourScale = 'linear' | 'symmetric' | 'log';

export interface ContourPlotProps {
  plane: PlaneField;
  levels?: number;
  /** Draw the isolines. Off leaves the filled map alone, which reads better on a noisy field. */
  lines?: boolean;
  scale?: ContourScale;
  width?: number;
  height?: number;
}

/** Decades shown below the maximum on a log scale; deeper than this is numerical noise. */
const LOG_DECADES = 6;

/**
 * The field as it will be coloured, and the range to colour it over.
 *
 * Shared by the contour and the rubbersheet: the two are the same numbers in two layouts, so a
 * scale that makes one legible has to make the other legible too.
 */
export function scaledField(
  values: readonly (readonly number[])[],
  scale: ContourScale,
): { shown: readonly (readonly number[])[]; lo: number; hi: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const row of values)
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  if (scale === 'log') {
    // log of the magnitude, floored a fixed number of decades under the peak so that vacuum does
    // not stretch the scale to minus infinity
    const peak = Math.max(Math.abs(min), Math.abs(max)) || 1;
    const floor = peak * 10 ** -LOG_DECADES;
    return {
      shown: values.map((row) => row.map((v) => Math.log10(Math.max(Math.abs(v), floor)))),
      lo: Math.log10(floor),
      hi: Math.log10(peak),
    };
  }
  if (scale === 'symmetric') {
    const m = Math.max(Math.abs(min), Math.abs(max));
    return { shown: values, lo: -m, hi: m };
  }
  return { shown: values, lo: min, hi: max };
}

export function ContourPlot({
  plane,
  levels = 20,
  lines = true,
  scale = 'linear',
  width = 320,
  height = 300,
}: ContourPlotProps): React.ReactElement {
  const { x, y, values } = plane;

  const { shown, lo, hi } = useMemo(() => scaledField(values, scale), [values, scale]);

  const plot = {
    x0: MARGIN.left,
    x1: width - MARGIN.right,
    y0: height - MARGIN.bottom,
    y1: MARGIN.top,
  };
  const sx = (v: number): number =>
    plot.x0 + ((v - x[0]!) / (x[x.length - 1]! - x[0]!)) * (plot.x1 - plot.x0);
  // y grows upwards on the screen, downwards in SVG
  const sy = (v: number): number =>
    plot.y0 - ((v - y[0]!) / (y[y.length - 1]! - y[0]!)) * (plot.y0 - plot.y1);

  const isolines = useMemo(
    () =>
      lines
        ? contourLevels(lo, hi, Math.max(1, Math.min(levels, 60))).flatMap((level) =>
            marchingSquares(shown, x, y, level),
          )
        : [],
    [lines, lo, hi, levels, shown, x, y],
  );

  const span = hi - lo || 1;
  const cells: React.ReactElement[] = [];
  for (let i = 0; i + 1 < x.length; i++) {
    for (let j = 0; j + 1 < y.length; j++) {
      // the cell's own mean, so a cell is not coloured by whichever corner happens to be first
      const v = (shown[i]![j]! + shown[i + 1]![j]! + shown[i + 1]![j + 1]! + shown[i]![j + 1]!) / 4;
      const px = sx(x[i]!);
      const py = sy(y[j + 1]!);
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={px}
          y={py}
          // +0.6 so neighbouring cells overlap: exact widths leave hairline gaps when the
          // browser rounds them, and the map reads as a grid of tiles instead of a field
          width={sx(x[i + 1]!) - px + 0.6}
          height={sy(y[j]!) - py + 0.6}
          fill={cppawColor((v - lo) / span)}
          shapeRendering="crispEdges"
        />,
      );
    }
  }

  return (
    <svg
      className="contour-plot"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`contour of ${plane.name}`}
    >
      {cells}
      {isolines.map(([ax, ay, bx, by], k) => (
        <line
          key={k}
          x1={sx(ax)}
          y1={sy(ay)}
          x2={sx(bx)}
          y2={sy(by)}
          stroke="#000"
          strokeWidth={0.5}
          strokeOpacity={0.55}
        />
      ))}
      <rect
        x={plot.x0}
        y={plot.y1}
        width={plot.x1 - plot.x0}
        height={plot.y0 - plot.y1}
        fill="none"
        stroke="var(--border, #d8dce3)"
      />
      {[0, 1].map((k) => (
        <text
          key={`xt${k}`}
          x={k === 0 ? plot.x0 : plot.x1}
          y={plot.y0 + 14}
          textAnchor={k === 0 ? 'start' : 'end'}
          className="chart-tick"
        >
          {(k === 0 ? x[0]! : x[x.length - 1]!).toFixed(1)}
        </text>
      ))}
      <text x={(plot.x0 + plot.x1) / 2} y={height - 2} textAnchor="middle" className="chart-tick">
        Å
      </text>
      {[0, 1].map((k) => (
        <text
          key={`yt${k}`}
          x={plot.x0 - 4}
          y={k === 0 ? plot.y0 : plot.y1 + 8}
          textAnchor="end"
          className="chart-tick"
        >
          {(k === 0 ? y[0]! : y[y.length - 1]!).toFixed(1)}
        </text>
      ))}
    </svg>
  );
}
