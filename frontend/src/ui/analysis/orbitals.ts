/** List helpers for the orbital browser (labels and occupations come from the backend). */
import type { OrbitalEntry } from '../../api/client';

/** Orbitals of one k-point and spin channel, sorted by band. */
export function channelOrbitals(
  all: readonly OrbitalEntry[],
  kpoint: number,
  spin: number,
): OrbitalEntry[] {
  return all.filter((o) => o.kpoint === kpoint && o.spin === spin).sort((a, b) => a.band - b.band);
}

/** Index of the highest occupied entry, or -1. */
export function homoIndex(rows: readonly OrbitalEntry[]): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.occupation > 0) return i;
  return -1;
}

/** Index of the lowest unoccupied entry above the HOMO, or -1. */
export function lumoIndex(rows: readonly OrbitalEntry[]): number {
  const h = homoIndex(rows);
  return h + 1 < rows.length ? h + 1 : -1;
}

/** Move the selection by `delta` rows, clamped to the list. */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1;
  const base = current < 0 ? (delta > 0 ? -1 : length) : current;
  return Math.min(length - 1, Math.max(0, base + delta));
}

/** Distinct k-point / spin indices present in the list (sorted). */
export function channels(all: readonly OrbitalEntry[]): { kpoints: number[]; spins: number[] } {
  const k = new Set<number>();
  const s = new Set<number>();
  for (const o of all) {
    k.add(o.kpoint);
    s.add(o.spin);
  }
  return { kpoints: [...k].sort((a, b) => a - b), spins: [...s].sort((a, b) => a - b) };
}
