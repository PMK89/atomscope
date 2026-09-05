import { useEffect, useMemo, useRef } from 'react';
import { useCalculationStore, type LogLine } from '../state/calculationStore';

/**
 * Streamed output of the selected calculation: its main job first, then post-processing
 * (analysis) jobs in submission order.
 *
 * The store selectors return stable references only (the `logs` record and the calculation
 * object); the per-job concatenation happens in `useMemo`. Returning a freshly built array from
 * a zustand selector would make `useSyncExternalStore` see a new snapshot on every render and
 * loop forever.
 */
export function JobConsole(): JSX.Element {
  const selected = useCalculationStore((s) => s.calculations.find((c) => c.id === s.selectedId));
  const allLogs = useCalculationStore((s) => s.logs);
  const ref = useRef<HTMLDivElement>(null);

  const logs = useMemo<LogLine[]>(() => {
    const ids = [selected?.job?.id, ...(selected?.analysis_jobs ?? []).map((a) => a.job?.id)];
    return ids.flatMap((id) => (id ? (allLogs[id] ?? []) : []));
  }, [selected, allLogs]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);

  return (
    <div className="console" ref={ref} data-testid="console">
      {!selected && <span className="muted">Select or run a calculation to see its output.</span>}
      {logs.map((l, i) => (
        <div key={i} className={`console-line stream-${l.stream.replace(/\W/g, '_')}`}>
          <span className="console-stream">{l.stream}</span> {l.line}
        </div>
      ))}
    </div>
  );
}
