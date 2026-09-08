/**
 * Field cuts: the same numbers as a contour map and as a rubbersheet, which is how `paw_wave.x`
 * offers them and how the course's ch. 3 pictures are drawn.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, type PlaneField } from '../../api/client';
import { ContourPlot, type ContourScale } from './ContourPlot';
import { RubberSheet } from './RubberSheet';

type Mode = 'contour' | 'sheet';

export function PlanesView({ calcId }: { calcId: string }): React.ReactElement {
  const [names, setNames] = useState<string[] | null>(null);
  const [plane, setPlane] = useState<PlaneField | null>(null);
  const [mode, setMode] = useState<Mode>('contour');
  const [levels, setLevels] = useState(20);
  const [lines, setLines] = useState(true);
  const [scale, setScale] = useState<ContourScale>('linear');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlane(null);
    setError(null);
    api.cppaw
      .planes(calcId)
      .then((r) => setNames(r.planes ?? []))
      .catch(() => setNames([]));
  }, [calcId]);

  const load = useCallback(
    (name: string) => {
      setError(null);
      api.cppaw
        .plane(calcId, name)
        .then(setPlane)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [calcId],
  );

  // one cut is the common case, and making the user pick it from a list of one helps nobody
  useEffect(() => {
    if (names && names.length > 0) load(names[0]!);
  }, [names, load]);

  if (names === null) return <p className="muted">Looking for field cuts…</p>;
  if (names.length === 0) {
    return (
      <p className="muted">
        No field cuts in this calculation. They are written alongside the cube whenever a density or
        an orbital is exported — re-run the export to get them.
      </p>
    );
  }

  return (
    <>
      {names.length > 1 && (
        <div className="form-row">
          <label htmlFor="plane-pick">cut</label>
          <select id="plane-pick" value={plane?.name ?? ''} onChange={(e) => load(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="button-row">
        {(['contour', 'sheet'] as const).map((m) => (
          <button key={m} className={mode === m ? 'tab active' : 'tab'} onClick={() => setMode(m)}>
            {m === 'contour' ? 'Contour' : 'Rubbersheet'}
          </button>
        ))}
      </div>
      <div className="form-row">
        <label htmlFor="plane-scale">scale</label>
        <select
          id="plane-scale"
          value={scale}
          onChange={(e) => setScale(e.target.value as ContourScale)}
        >
          <option value="linear">linear</option>
          <option value="symmetric">symmetric about zero</option>
          <option value="log">logarithmic</option>
        </select>
      </div>
      {error !== null && <p className="muted">{error}</p>}
      {plane === null ? (
        <p className="muted">Loading the cut…</p>
      ) : mode === 'contour' ? (
        <>
          <ContourPlot plane={plane} levels={levels} lines={lines} scale={scale} />
          <div className="form-row">
            <label htmlFor="plane-levels">levels {levels}</label>
            <input
              id="plane-levels"
              type="range"
              min="1"
              max="60"
              value={levels}
              onChange={(e) => setLevels(Number(e.target.value))}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
            Contour lines
          </label>
        </>
      ) : (
        <RubberSheet plane={plane} scale={scale} />
      )}
      {plane !== null && (
        <p className="muted">
          {plane.nx}×{plane.ny} on a {(plane.x.at(-1)! - plane.x[0]!).toFixed(2)} ×{' '}
          {(plane.y.at(-1)! - plane.y[0]!).toFixed(2)} Å cut
        </p>
      )}
    </>
  );
}
