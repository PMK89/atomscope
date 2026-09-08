/**
 * The run's protocol, as text, plus the geometries it reports.
 *
 * The tutorial sends the reader to the `.prot` constantly -- it is where a failure explains
 * itself and where the code echoes back every setting it actually used -- so it is shown
 * verbatim rather than only through the charts derived from it. A protocol grows without bound
 * (one line per molecular-dynamics step), so it is paged, and the page shown first is the last
 * one.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, type ProtocolText } from '../../api/client';
import { trajectoryFromJson } from '../../model/trajectory';
import { useTrajectoryStore } from '../../state/trajectoryStore';

const PAGE_SIZES = [200, 400, 1000, 4000];

export function ProtocolView({ calcId }: { calcId: string }): React.ReactElement {
  const [page, setPage] = useState<ProtocolText | null>(null);
  const [limit, setLimit] = useState(400);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const loadTrajectory = useTrajectoryStore((s) => s.load);

  /** `offset === null` means "the end of the file", which is the useful default. */
  const show = useCallback(
    (offset: number | null) => {
      setError(null);
      api.cppaw
        .protocol(calcId, { limit, ...(offset === null ? {} : { offset }) })
        .then(setPage)
        .catch((e: unknown) => {
          setPage(null);
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [calcId, limit],
  );

  useEffect(() => {
    show(null);
  }, [show]);

  const showGeometries = (): void => {
    setNote(null);
    api.cppaw
      .protocolStructures(calcId)
      .then((t) => {
        loadTrajectory(trajectoryFromJson(t));
        const n = t.frames?.length ?? 0;
        setNote(`${n} reported ${n === 1 ? 'geometry' : 'geometries'} loaded — use the player`);
      })
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)));
  };

  if (error !== null) return <p className="muted">No protocol to show: {error}</p>;
  if (page === null) return <p className="muted">Loading the protocol…</p>;

  const last = page.offset + page.text.split('\n').length;
  const atStart = page.offset === 0;
  const atEnd = last >= page.total_lines;

  return (
    <>
      <div className="button-row">
        <button onClick={() => show(0)} disabled={atStart}>
          Start
        </button>
        <button onClick={() => show(Math.max(0, page.offset - limit))} disabled={atStart}>
          ← Earlier
        </button>
        <button onClick={() => show(page.offset + limit)} disabled={atEnd}>
          Later →
        </button>
        <button onClick={() => show(null)} disabled={atEnd}>
          End
        </button>
        <select
          id="prot-limit"
          className="compact-select"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="lines per page"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} lines
            </option>
          ))}
        </select>
      </div>
      <p className="muted">
        {page.name} · lines {page.offset + 1}–{Math.min(last, page.total_lines)} of{' '}
        {page.total_lines}
        {(page.run_starts?.length ?? 0) > 1 && <> · {page.run_starts?.length} runs appended</>}
      </p>
      {/* The protocol is data. React escapes it; nothing here interprets it. */}
      <pre className="protocol-text">{page.text}</pre>
      <div className="button-row">
        <button onClick={showGeometries}>Show reported geometries</button>
      </div>
      {note !== null && <p className="muted">{note}</p>}
    </>
  );
}
