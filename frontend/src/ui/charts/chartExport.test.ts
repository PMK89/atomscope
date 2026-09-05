import { expect, test } from 'vitest';
import { chartSize, chartSvgMarkup, svgDataUrl } from './chartExport';

const chart = (): SVGSVGElement => {
  const host = document.createElement('div');
  host.innerHTML = `
    <svg class="line-chart" viewBox="0 0 320 240" role="img" aria-label="IR spectrum">
      <text class="chart-title">IR spectrum</text>
      <polyline stroke="#2f6fdb" points="0,0 1,1"></polyline>
      <g class="chart-hover"><text class="chart-readout">1595 @ 62</text></g>
    </svg>`;
  return host.querySelector('svg')!;
};

test('the exported markup stands on its own: sized, styled, on white, without the hover readout', () => {
  const markup = chartSvgMarkup(chart());
  expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(markup).toContain('width="320"');
  expect(markup).toContain('height="240"');
  // the theme variables the live chart reads are not in the file, so the colours are written out
  expect(markup).not.toContain('var(--');
  expect(markup).toContain('.chart-tick, .chart-label, .chart-title { fill: #1c1e21; }');
  expect(markup).toContain('fill="#ffffff"');
  // the series keeps the colour it is drawn with
  expect(markup).toContain('stroke="#2f6fdb"');
  expect(markup).toContain('IR spectrum');
  // the readout follows the pointer and is not part of the plot
  expect(markup).not.toContain('chart-hover');
  expect(markup).not.toContain('1595 @ 62');
});

test('a chart with no usable viewBox still exports at a sensible size', () => {
  const svg = chart();
  svg.removeAttribute('viewBox');
  expect(chartSize(svg)).toEqual({ width: 320, height: 200 });
});

test('the data URL is an image the browser will decode', () => {
  const url = svgDataUrl(chartSvgMarkup(chart()));
  expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  expect(decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))).toContain(
    '<svg',
  );
});
