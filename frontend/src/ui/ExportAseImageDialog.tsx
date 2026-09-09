/**
 * File ▸ Render with ASE… — the structure through ASE's own image writers.
 *
 * Distinct from Export image…, which grabs the viewport canvas: that is a screenshot of what is
 * on screen, this is a render from the structure with ASE's parameters, which is how `asecppaw`'s
 * `simplePOV` makes the course's figures. The parameters are ASE's, at ASE's defaults, with the
 * names ASE uses -- the whole point being that someone who knows `ase.io.write` finds them here.
 *
 * POV-Ray is not installed on this machine, so `pov` writes the scene and its `.ini` and the
 * response says so rather than pretending to have rendered.
 */
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { dialogKeyHandler } from './dialogKeys';
import { useStructureStore } from '../state/structureStore';

const FORMATS = ['png', 'eps', 'pov', 'x3d', 'html'] as const;
type Format = (typeof FORMATS)[number];

export function ExportAseImageDialog({
  open,
  onClose,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}): JSX.Element | null {
  const doc = useStructureStore((s) => s.doc);
  const [format, setFormat] = useState<Format>('png');
  const [rotation, setRotation] = useState('auto');
  const [scale, setScale] = useState(20);
  const [showCell, setShowCell] = useState(2);
  const [cameraDist, setCameraDist] = useState(50);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [transparent, setTransparent] = useState(true);
  const [bonds, setBonds] = useState(true);
  const [path, setPath] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;

  const isPov = format === 'pov';
  const isRaster = format === 'png' || format === 'eps';

  const run = (): void => {
    setBusy(true);
    setResult(null);
    // the viewport's own bonds, so the render matches what is on screen
    const bondatoms = bonds ? doc.bonds.map((b) => [b.a, b.b] as [number, number]) : [];
    api.io
      .exportImage({
        structure: doc as unknown,
        format,
        ...(path.trim() ? { path: path.trim(), overwrite: true } : {}),
        options: {
          rotation,
          scale,
          show_unit_cell: showCell,
          camera_dist: cameraDist,
          canvas_width: canvasWidth,
          transparent,
          bondatoms,
        },
      })
      .then((r) => {
        const files = (r.files ?? []).join(', ');
        setResult(r.note ? `${files} — ${r.note}` : files);
      })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={dialog}
        role="dialog"
        aria-label="Render with ASE"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={dialogKeyHandler(dialog, onClose)}
      >
        <h3>Render with ASE</h3>
        <div className="form-row">
          <label htmlFor="ase-format">format</label>
          <select
            id="ase-format"
            ref={first}
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        {format !== 'x3d' && format !== 'html' && (
          <>
            <div className="form-row">
              <label htmlFor="ase-rot">rotation</label>
              <input
                id="ase-rot"
                value={rotation}
                onChange={(e) => setRotation(e.target.value)}
                placeholder="e.g. 90x,20y"
              />
            </div>
            <p className="muted">
              ASE&apos;s rotation string. <code>auto</code> turns the structure to face the camera,
              the way <code>simplePOV</code> does.
            </p>
            <div className="form-row">
              <label htmlFor="ase-cell">unit cell</label>
              <select
                id="ase-cell"
                value={showCell}
                onChange={(e) => setShowCell(Number(e.target.value))}
              >
                <option value={0}>hidden</option>
                <option value={1}>behind the atoms</option>
                <option value={2}>in front</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={bonds} onChange={(e) => setBonds(e.target.checked)} />
              Draw the bonds the viewport shows
            </label>
          </>
        )}
        {isRaster && (
          <div className="form-row">
            <label htmlFor="ase-scale">scale {scale} px/Å</label>
            <input
              id="ase-scale"
              type="range"
              min="5"
              max="120"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            />
          </div>
        )}
        {isPov && (
          <>
            <div className="form-row">
              <label htmlFor="ase-canvas">canvas width</label>
              <input
                id="ase-canvas"
                type="number"
                min="64"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(Number(e.target.value))}
              />
            </div>
            <div className="form-row">
              <label htmlFor="ase-cam">camera distance</label>
              <input
                id="ase-cam"
                type="number"
                step="any"
                value={cameraDist}
                onChange={(e) => setCameraDist(Number(e.target.value))}
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
              />
              Transparent background
            </label>
          </>
        )}
        <div className="form-row">
          <label htmlFor="ase-path">write to</label>
          <input
            id="ase-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="leave empty for the app's scratch directory"
          />
        </div>
        {result !== null && <p className="muted">Wrote {result}</p>}
        <div className="button-row">
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? 'Rendering…' : 'Render'}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
