/**
 * The per-chart graph controls: what they change on the chart, and what they leave alone.
 *
 * The parameter set follows `asecppaw`'s `plotDefault` -- axis limits, a log axis, markers, line
 * weight, legend -- so these assert the translation rather than the widget.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { LineChart, type ChartSeries } from './LineChart';
import {
  DEFAULT_CHART_SETTINGS,
  canLogY,
  useChartSettingsStore,
} from '../../state/chartSettingsStore';

const SERIES: ChartSeries[] = [
  { id: 'a', label: 'a', x: [0, 1, 2], y: [1, 10, 100], color: '#123456' },
  { id: 'b', label: 'b', x: [0, 1, 2], y: [2, 20, 200], color: '#654321' },
];

const store = useChartSettingsStore;

describe('chart settings', () => {
  beforeEach(() => {
    store.setState({ byChart: {} });
  });

  it('does not appear on a chart with no id', () => {
    const { container } = render(<LineChart series={SERIES} />);
    expect(container.querySelector('.chart-settings')).toBeNull();
  });

  it('appears on a chart with one, and starts at the defaults', () => {
    const { container } = render(<LineChart series={SERIES} settingsId="t" />);
    expect(container.querySelector('.chart-settings-toggle')).not.toBeNull();
    expect(store.getState().get('t')).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('draws a marker per sample only when asked', () => {
    const { container, rerender } = render(<LineChart series={SERIES} settingsId="t" />);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    store.getState().set('t', { markers: true });
    rerender(<LineChart series={SERIES} settingsId="t" />);
    // one per point of each series
    expect(container.querySelectorAll('circle')).toHaveLength(6);
  });

  it('sets the line weight', () => {
    store.getState().set('t', { lineWidth: 3.5 });
    const { container } = render(<LineChart series={SERIES} settingsId="t" />);
    for (const p of container.querySelectorAll('polyline')) {
      expect(p.getAttribute('stroke-width')).toBe('3.5');
    }
  });

  it('hides the legend on request', () => {
    const { container, rerender } = render(<LineChart series={SERIES} settingsId="t" />);
    expect(container.querySelector('.chart-legend')).not.toBeNull();
    store.getState().set('t', { legend: false });
    rerender(<LineChart series={SERIES} settingsId="t" />);
    expect(container.querySelector('.chart-legend')).toBeNull();
  });

  it('fixes only the end of an axis that was given a number', () => {
    const before = render(<LineChart series={SERIES} settingsId="t" />);
    const ticksBefore = [...before.container.querySelectorAll('text')].map((t) => t.textContent);
    // the data reaches 200, so an automatic axis has to show it
    expect(ticksBefore).toContain('200');
    before.unmount();

    store.getState().set('t', { yMax: 50 });
    const after = render(<LineChart series={SERIES} settingsId="t" />);
    const ticksAfter = [...after.container.querySelectorAll('text')].map((t) => t.textContent);
    // the top is the number asked for; the bottom still comes from the data, because yMin was
    // left empty -- setting one end must not quietly fix the other
    expect(ticksAfter).toContain('50');
    expect(ticksAfter).not.toContain('200');
    expect(Math.min(...ticksAfter.map(Number).filter(Number.isFinite))).toBeLessThan(50);
  });

  it('keeps a curve narrowed out of the frame from being drawn over the axes', () => {
    // A range narrower than the data is a frame, not a filter: the points outside stay in the
    // polyline, so the slope at the edge is the real one. Without a clip they would be painted
    // across the tick labels and the axis, which reads as a broken chart.
    store.getState().set('t', { yMax: 50 });
    const { container } = render(<LineChart series={SERIES} settingsId="t" />);
    const svg = container.querySelector('svg')!;
    const clip = svg.querySelector('clipPath > rect')!;
    const group = svg.querySelector('g[clip-path]')!;
    expect(group.querySelectorAll('polyline')).toHaveLength(2);

    // the clip is the plot area itself, and the points that left it are still in the line
    const top = Number(clip.getAttribute('y'));
    const bottom = top + Number(clip.getAttribute('height'));
    const ys = group
      .querySelectorAll('polyline')[0]!
      .getAttribute('points')!
      .split(' ')
      .map((pt) => Number(pt.split(',')[1]));
    expect(ys).toHaveLength(3);
    expect(Math.min(...ys)).toBeLessThan(top); // y=100 and y=200 are above the frame
    expect(bottom).toBeGreaterThan(top);
  });

  it('switches to a log axis, and drops the non-positive points it cannot draw', () => {
    const withZero: ChartSeries[] = [
      { id: 'z', label: 'z', x: [0, 1, 2], y: [0, 10, 100], color: '#000' },
    ];
    store.getState().set('t', { logY: true });
    const { container } = render(<LineChart series={withZero} settingsId="t" />);
    const points = container.querySelector('polyline')!.getAttribute('points')!.split(' ');
    // the zero cannot be placed on a log axis, so two points remain, not three
    expect(points).toHaveLength(2);
    for (const p of points) expect(p).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  });

  it('resets back to the defaults', () => {
    store.getState().set('t', { markers: true, yMax: 5, logY: true });
    expect(store.getState().get('t')).not.toEqual(DEFAULT_CHART_SETTINGS);
    store.getState().reset('t');
    expect(store.getState().get('t')).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('keeps one chart out of another chart settings', () => {
    store.getState().set('one', { markers: true });
    expect(store.getState().get('two')).toEqual(DEFAULT_CHART_SETTINGS);
  });
});

describe('canLogY', () => {
  it('is false when there is nothing positive to plot', () => {
    expect(canLogY([{ y: [0, -1, -2] }])).toBe(false);
    expect(canLogY([{ y: [0, 1] }])).toBe(true);
    expect(canLogY([])).toBe(false);
  });
});
