import { fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { LineChart } from './LineChart';

const series = [
  { id: 's', label: 'IR', x: [400, 1000, 2000, 4000], y: [0, 5, 2, 1], color: '#000' },
];

function lineAt(svg: SVGSVGElement, selector: string): SVGLineElement[] {
  return Array.from(svg.querySelectorAll<SVGLineElement>(selector));
}

test('sticks are drawn from zero to their value', () => {
  const { container } = render(
    <LineChart
      series={[]}
      sticks={[
        { x: 1000, y: 10 },
        { x: 3000, y: 4, active: true },
      ]}
    />,
  );
  const svg = container.querySelector('svg')!;
  const sticks = lineAt(svg, '.chart-stick');
  expect(sticks).toHaveLength(2);
  expect(sticks[1]!.getAttribute('class')).toContain('active');
  // both sticks share the same baseline y1 (the zero line)
  expect(sticks[0]!.getAttribute('y1')).toBe(sticks[1]!.getAttribute('y1'));
  // the taller stick reaches a smaller y2 (SVG y grows downwards)
  expect(Number(sticks[0]!.getAttribute('y2'))).toBeLessThan(Number(sticks[1]!.getAttribute('y2')));
});

test('xReversed flips the pixel range but keeps ticks and markers', () => {
  const normal = render(<LineChart series={series} markers={[{ x: 1000, label: 'peak' }]} />);
  const reversed = render(
    <LineChart series={series} markers={[{ x: 1000, label: 'peak' }]} xReversed />,
  );
  const ticks = (c: HTMLElement): string[] =>
    Array.from(c.querySelectorAll('.chart-tick')).map((t) => t.textContent ?? '');
  // the same tick labels appear in both orientations
  expect(new Set(ticks(reversed.container))).toEqual(new Set(ticks(normal.container)));
  // and the marker survives (a reversed *domain* would filter it out)
  expect(reversed.container.querySelectorAll('.chart-marker')).toHaveLength(1);
  // the polyline runs the other way: first point is on the right instead of the left
  const first = (c: HTMLElement): number =>
    Number(c.querySelector('polyline')!.getAttribute('points')!.split(',')[0]);
  expect(first(reversed.container)).toBeGreaterThan(first(normal.container));
});

test('onPick reports the data-space x of a click inside the plot', () => {
  const onPick = vi.fn();
  const { container } = render(
    <LineChart series={series} width={320} height={200} onPick={onPick} />,
  );
  const svg = container.querySelector('svg')!;
  svg.getBoundingClientRect = (): DOMRect =>
    ({ left: 0, top: 0, width: 320, height: 200 }) as DOMRect;
  fireEvent.click(svg, { clientX: 160, clientY: 100 });
  expect(onPick).toHaveBeenCalledTimes(1);
  const x = onPick.mock.calls[0]![0] as number;
  expect(x).toBeGreaterThan(400);
  expect(x).toBeLessThan(4000);
  // clicks in the left margin (outside the plot area) are ignored
  fireEvent.click(svg, { clientX: 5, clientY: 100 });
  expect(onPick).toHaveBeenCalledTimes(1);
});

test('names the series in a legend, except the ones marked quiet', () => {
  const { container } = render(
    <LineChart
      series={[
        { id: 'a', label: 'oxygen p', x: [0, 1], y: [1, 2], color: '#f00' },
        { id: 'b', label: 'hydrogen s', x: [0, 1], y: [2, 3], color: '#00f' },
      ]}
    />,
  );
  const legend = container.querySelector('.chart-legend');
  expect(legend).not.toBeNull();
  expect(legend!.textContent).toBe('oxygen phydrogen s');

  // twenty band curves are not worth naming one by one, which is what `quiet` is for
  const quiet = render(
    <LineChart
      series={[
        { id: 'a', label: 'band 1', x: [0, 1], y: [1, 2], color: '#f00', quiet: true },
        { id: 'b', label: 'band 2', x: [0, 1], y: [2, 3], color: '#f00', quiet: true },
      ]}
    />,
  );
  expect(quiet.container.querySelector('.chart-legend')).toBeNull();
});

test('does not put a legend on a single series', () => {
  const { container } = render(
    <LineChart series={[{ id: 'a', label: 'total', x: [0, 1], y: [1, 2], color: '#f00' }]} />,
  );
  expect(container.querySelector('.chart-legend')).toBeNull();
});
