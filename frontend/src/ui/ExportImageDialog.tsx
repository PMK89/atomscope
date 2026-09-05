/**
 * File > Export image… (Avogadro's Export Graphics): the viewport at a chosen resolution, as PNG
 * with an optional transparent background or as JPEG.
 *
 * The size is the viewport times a multiplier, so what is framed on screen is what comes out.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRendererStore } from '../state/rendererStore';
import { useStructureStore } from '../state/structureStore';

const SCALES = [1, 2, 4];

/** Hand the data URL to the browser as a download. */
export function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** A file name from the document name: no separators, no surprises. */
export function imageFileName(docName: string, type: string): string {
  const base = docName.trim().replace(/[^A-Za-z0-9._-]+/g, '_') || 'atomscope';
  return `${base}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
}

export function ExportImageDialog({
  open,
  onClose,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}): JSX.Element | null {
  const renderer = useRendererStore((s) => s.renderer);
  const name = useStructureStore((s) => s.doc.name);
  const [scale, setScale] = useState(2);
  const [type, setType] = useState('image/png');
  const [transparent, setTransparent] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;

  const size = renderer?.viewportSize ?? { width: 0, height: 0 };
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  // a render target beyond the texture limit fails silently, so those sizes are not offered
  const limit = renderer?.maxImageSize ?? Infinity;
  const fits = (s: number): boolean =>
    Math.round(size.width * s) <= limit && Math.round(size.height * s) <= limit;

  const save = (): void => {
    if (!renderer) {
      onError('The viewport is not ready yet');
      return;
    }
    try {
      const url = renderer.exportImage({
        width,
        height,
        transparent: transparent && type === 'image/png',
        type,
      });
      if (!url) throw new Error('the image could not be encoded');
      downloadDataUrl(url, imageFileName(name, type));
      onClose();
    } catch (e) {
      onError(`Export failed: ${(e as Error).message}`);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog panel" role="dialog" aria-modal="true" aria-label="Export image">
        <h3>Export image</h3>
        <div className="form-row">
          <label htmlFor="export-scale">Resolution</label>
          <select
            id="export-scale"
            ref={first}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            {SCALES.filter(fits).map((s) => (
              <option key={s} value={s}>
                {s}× ({Math.round(size.width * s)} × {Math.round(size.height * s)})
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="export-format">Format</label>
          <select id="export-format" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPEG</option>
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="export-transparent">Transparent background</label>
          <input
            id="export-transparent"
            type="checkbox"
            checked={transparent && type === 'image/png'}
            disabled={type !== 'image/png'}
            onChange={() => setTransparent(!transparent)}
          />
        </div>
        {type !== 'image/png' && <p className="muted">JPEG has no transparency.</p>}
        <div className="button-row">
          <button onClick={save}>Save</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
