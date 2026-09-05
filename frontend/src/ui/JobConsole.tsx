import { useEffect, useRef } from 'react';
import { useCalculationStore, type LogLine } from '../state/calculationStore';

export function JobConsole(): JSX.Element {
  const selected = useCalculationStore((s) => s.calculations.find((c) => c.id === s.selectedId));
  const logs = useCalculationStore((s) => {
    // main job first, then post-processing (analysis) jobs in submission order
    const ids = [selected?.job?.id, ...(selected?.analysis_jobs ?? []).map((a) => a.job.id)];
    const lines = ids.flatMap((id) => (id ? (s.logs[id] ?? []) : []));
    return lines.length > 0 ? lines : undefined;
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs?.length]);
  return (
    <div className="console" ref={ref} data-testid="console">
      {!selected && <span className="muted">Select or run a calculation to see its output.</span>}
      {logs?.map((l: LogLine, i: number) => (
        <div key={i} className={`console-line stream-${l.stream.replace(/\W/g, '_')}`}>
          <span className="console-stream">{l.stream}</span> {l.line}
        </div>
      ))}
    </div>
  );
}
