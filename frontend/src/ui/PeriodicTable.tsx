import { ELEMENTS } from '../model/elements';

/** Column (1-18) and row (1-7, 8/9 for the f-block) for atomic numbers 1..118. */
function cell(z: number): { row: number; col: number } {
  if (z === 1) return { row: 1, col: 1 };
  if (z === 2) return { row: 1, col: 18 };
  if (z <= 18) {
    const row = z <= 10 ? 2 : 3;
    const start = row === 2 ? 3 : 11;
    const off = z - start; // 0..7
    return { row, col: off < 2 ? off + 1 : off + 11 };
  }
  if (z <= 54) {
    const row = z <= 36 ? 4 : 5;
    return { row, col: z - (row === 4 ? 18 : 36) };
  }
  if (z >= 57 && z <= 71) return { row: 9, col: z - 57 + 3 };
  if (z >= 89 && z <= 103) return { row: 10, col: z - 89 + 3 };
  if (z <= 86) return { row: 6, col: z <= 56 ? z - 54 : z - 68 };
  return { row: 7, col: z <= 88 ? z - 86 : z - 100 };
}

export function PeriodicTable({
  value,
  onPick,
}: {
  value: string;
  onPick: (symbol: string) => void;
}): JSX.Element {
  return (
    <div className="periodic-table" role="listbox" aria-label="Periodic table">
      {ELEMENTS.filter((e) => e.number >= 1 && e.number <= 118).map((e) => {
        const { row, col } = cell(e.number);
        const [r, g, b] = e.color.map((c) => Math.round(c * 255));
        return (
          <button
            key={e.symbol}
            role="option"
            aria-selected={e.symbol === value}
            title={`${e.symbol} (${e.number})`}
            className={e.symbol === value ? 'pt-cell active' : 'pt-cell'}
            style={{ gridRow: row, gridColumn: col, borderBottomColor: `rgb(${r},${g},${b})` }}
            onClick={() => onPick(e.symbol)}
          >
            {e.symbol}
          </button>
        );
      })}
    </div>
  );
}
