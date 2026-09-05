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
