/** Selection helpers: rubber-band containment and mode-dependent expansion. */
import { fragmentOf } from '../model/connectivity';
import type { StructureDoc } from '../model/structure';

export type SelectionMode = 'atoms' | 'residues' | 'molecules';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normalizeRect(r: Rect): Rect {
  return {
    x0: Math.min(r.x0, r.x1),
    y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1),
    y1: Math.max(r.y0, r.y1),
  };
}

/** Indices whose projected screen positions lie inside the rectangle (inclusive). */
export function atomsInRect(
  rect: Rect,
  projected: ReadonlyArray<{ x: number; y: number } | null>,
): number[] {
  const r = normalizeRect(rect);
  const out: number[] = [];
  projected.forEach((p, i) => {
    if (p && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) out.push(i);
  });
  return out;
}

/** Expand picked atoms to whole residues / connected fragments according to the mode. */
export function expandSelection(
  doc: StructureDoc,
  atoms: Iterable<number>,
  mode: SelectionMode,
): Set<number> {
  const out = new Set<number>();
  for (const i of atoms) {
    if (mode === 'molecules') for (const j of fragmentOf(doc, i)) out.add(j);
    else if (mode === 'residues') {
      const res = doc.residues.find((r) => r.atom_indices.includes(i));
      if (res) for (const j of res.atom_indices) out.add(j);
      else out.add(i);
    } else out.add(i);
  }
  return out;
}

/** Combine a new pick with the existing selection: shift adds, ctrl toggles, else replaces. */
export function combineSelection(
  current: ReadonlySet<number>,
  picked: Iterable<number>,
  modifier: 'replace' | 'add' | 'toggle',
): Set<number> {
  const next = modifier === 'replace' ? new Set<number>() : new Set(current);
  for (const i of picked) {
    if (modifier === 'toggle' && current.has(i)) next.delete(i);
    else next.add(i);
  }
  return next;
}

export function invertSelection(doc: StructureDoc, current: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < doc.atoms.length; i++) if (!current.has(i)) out.add(i);
  return out;
}

export function atomsOfElement(doc: StructureDoc, element: string): number[] {
  const out: number[] = [];
  doc.atoms.forEach((a, i) => {
    if (a.element === element) out.push(i);
  });
  return out;
}

/** Residue names that mean "solvent or a counter-ion", as PDB files write them. */
const SOLVENT_RESIDUES = new Set([
  'HOH',
  'WAT',
  'SOL',
  'TIP',
  'TIP3',
  'TIP4',
  'DOD',
  'H2O',
  // counter-ions, matched as residue *names*: an alpha carbon is the atom name CA, not a residue
  'NA',
  'CL',
  'K',
  'MG',
  'CA',
  'ZN',
  'MN',
  'FE',
  'SO4',
  'PO4',
]);

/** Atoms of every solvent or ion residue (Avogadro's Select Solvent). */
export function solventAtoms(doc: StructureDoc): number[] {
  const out: number[] = [];
  for (const r of doc.residues) {
    if (SOLVENT_RESIDUES.has(r.name.trim().toUpperCase())) out.push(...r.atom_indices);
  }
  return out;
}

/**
 * Atoms of the residues named by `spec`, a comma-separated list of
 * `LYS` (every lysine), `12` (residue number 12), `12-20` (a range) or `A:12` / `A:12-20`
 * (restricted to one chain). Numbers are residue numbers as the file gives them, not indices.
 */
export function atomsOfResidues(doc: StructureDoc, spec: string): number[] {
  const terms = spec
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const out = new Set<number>();
  for (const term of terms) {
    const [chain, rest] = term.includes(':')
      ? [term.slice(0, term.indexOf(':')).trim(), term.slice(term.indexOf(':') + 1).trim()]
      : [null, term];
    const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(rest);
    const number = /^-?\d+$/.test(rest) ? Number(rest) : null;
    for (const r of doc.residues) {
      if (chain !== null && r.chain.toUpperCase() !== chain.toUpperCase()) continue;
      const matched = range
        ? r.number >= Number(range[1]) && r.number <= Number(range[2])
        : number !== null
          ? r.number === number
          : r.name.trim().toUpperCase() === rest.toUpperCase();
      if (matched) for (const i of r.atom_indices) out.add(i);
    }
  }
  return [...out].sort((a, b) => a - b);
}
