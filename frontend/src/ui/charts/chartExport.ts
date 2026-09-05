/**
 * A chart as a file: the on-screen SVG, standing on its own.
 *
 * `LineChart` draws with CSS classes whose colours come from the app's theme variables, so a
 * serialised copy of the live element would arrive at a plain black-on-nothing plot. The clone
 * made here carries its own style block instead -- a fixed light palette on white, which is what a
 * plot pasted into a paper or a slide wants, and which does not turn inside out with the theme the
 * chart happened to be exported from.
 *
 * Avogadro's Spectra dialog wrote raster images at a chosen size and DPI (spectradialog.cpp:929).
 * SVG carries that resolution choice better than a DPI box does; PNG is offered beside it for the
 * places that will not take a vector.
 */

/** Class colours matching the light theme, resolved so the file needs no stylesheet. */
const EXPORT_STYLE = `
.line-chart { font-family: system-ui, sans-serif; font-size: 10px; }
.chart-plot { fill: #ffffff; }
.chart-grid { stroke: #d0d4da; stroke-width: 1; }
.chart-axis { stroke: #1c1e21; stroke-width: 1; opacity: 0.6; }
.chart-marker { stroke: #2f6fdb; stroke-width: 1; stroke-dasharray: 3 3; }
.chart-tick, .chart-label, .chart-title { fill: #1c1e21; }
.chart-tick { opacity: 0.8; }
.chart-stick { stroke: #1c1e21; stroke-width: 1; opacity: 0.55; }
.chart-stick.active { stroke: #2f6fdb; stroke-width: 2; opacity: 1; }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The chart's drawing size, from its viewBox. */
export function chartSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = box[2];
  const height = box[3];
  return width && height && Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : { width: 320, height: 200 };
}

/** Standalone SVG markup for a chart element: its own styles, on white, without the hover readout. */
export function chartSvgMarkup(svg: SVGSVGElement): string {
  const { width, height } = chartSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  // the readout follows the pointer: it is not part of the plot
  for (const hover of [...clone.querySelectorAll('.chart-hover')]) hover.remove();

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = EXPORT_STYLE;
  clone.insertBefore(style, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** Rasterise the markup through an image and a canvas, `scale` times its drawing size. */
export function svgToPngDataUrl(
  markup: string,
  width: number,
  height: number,
  scale = 2,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('this browser gave no 2d canvas context'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = (): void => reject(new Error('the chart could not be rasterised'));
    image.src = svgDataUrl(markup);
  });
}
