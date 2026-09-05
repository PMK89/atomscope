/**
 * Which display type each atom is drawn with (Avogadro's engine primitive scoping: Add All,
 * Add Selected, Remove Selected, Display Only Selected, Assign to Selection).
 *
 * Avogadro gives every engine a list of primitives and lets several engines draw at once;
 * Atomscope has one structure layer, so the same effect is one display type per atom, plus
 * `hidden` for the atoms no engine draws. The assignment is keyed by atom **uid**, not by index:
 * hiding the solvent and then deleting one atom of the ligand must not un-hide the water.
 */
import type { StructureDoc } from '../model/structure';
import type { StructureStyle } from './layers/StructureLayer';

/** A display type, or `hidden` for an atom that is not drawn at all. */
export type AtomStyle = StructureStyle | 'hidden';

/** atom uid -> the display type that atom is drawn with. Absent means "the global display type". */
export type StyleAssignment = ReadonlyMap<string, AtomStyle>;

export const NO_STYLES: StyleAssignment = new Map();

function uidsOf(doc: StructureDoc, atoms: Iterable<number>): string[] {
  const out: string[] = [];
  for (const i of atoms) {
    const uid = doc.atoms[i]?.uid;
    if (uid) out.push(uid);
  }
  return out;
}

/**
 * Give `atoms` the display type `style`; `null` takes their assignment away, so they follow the
 * global display type again.
 */
export function assignStyle(
  current: StyleAssignment,
  doc: StructureDoc,
  atoms: Iterable<number>,
  style: AtomStyle | null,
): StyleAssignment {
  const next = new Map(current);
  for (const uid of uidsOf(doc, atoms)) {
    if (style === null) next.delete(uid);
    else next.set(uid, style);
  }
  return next;
}

/**
 * `atoms` are drawn (with `style`, or with whatever they already had when it is null) and every
 * other atom of the document is hidden -- Avogadro's Display Only Selected.
 */
export function displayOnly(
  current: StyleAssignment,
  doc: StructureDoc,
  atoms: Iterable<number>,
  style: AtomStyle | null,
): StyleAssignment {
  const shown = new Set(uidsOf(doc, atoms));
  const next = new Map<string, AtomStyle>();
  for (const atom of doc.atoms) {
    const uid = atom.uid;
    if (!uid) continue;
    if (!shown.has(uid)) next.set(uid, 'hidden');
    else if (style !== null) next.set(uid, style);
    else {
      const had = current.get(uid);
      if (had !== undefined && had !== 'hidden') next.set(uid, had);
    }
  }
  return next;
}

/**
 * The assignment as one entry per atom index, which is what the structure layer consumes.
 * Null when this document has no assigned atom at all, which is the fast path: the layer then
 * skips the whole feature.
 */
export function styleArray(
  doc: StructureDoc,
  assignment: StyleAssignment,
): (AtomStyle | null)[] | null {
  if (assignment.size === 0) return null;
  let any = false;
  const out = doc.atoms.map((a) => {
    const style = (a.uid && assignment.get(a.uid)) || null;
    if (style) any = true;
    return style;
  });
  return any ? out : null;
}

/** Indices of the atoms nothing draws, so the label layer can leave them out too. */
export function hiddenAtoms(styles: (AtomStyle | null)[] | null): ReadonlySet<number> | null {
  if (!styles) return null;
  const out = new Set<number>();
  styles.forEach((s, i) => {
    if (s === 'hidden') out.add(i);
  });
  return out.size ? out : null;
}

/**
 * Whether two hidden sets hold the same atoms. The set is rebuilt whenever the document is, so a
 * layer that cached its geometry cannot compare it by identity: during a drag that would rebuild
 * the ribbon spline on every frame. Both null and both empty are the common case, and cheap.
 */
export function sameHidden(a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const i of a) if (!b.has(i)) return false;
  return true;
}

/** How many atoms of this document carry an assignment, and how many of those are hidden. */
export function assignmentCounts(
  doc: StructureDoc,
  assignment: StyleAssignment,
): { assigned: number; hidden: number } {
  let assigned = 0;
  let hidden = 0;
  for (const atom of doc.atoms) {
    const style = atom.uid ? assignment.get(atom.uid) : undefined;
    if (style === undefined) continue;
    assigned++;
    if (style === 'hidden') hidden++;
  }
  return { assigned, hidden };
}
