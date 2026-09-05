/**
 * Named selections (Avogadro's Add Named Selection…, kept by the GLWidget and listed under
 * "User Selections" in the project tree).
 *
 * A saved set names its atoms by **uid**, not by index, for the reason the display types and the
 * per-atom colours do: deleting one atom must not hand a set the atom that took its place. Atoms
 * a set names but the document no longer has are simply not recalled -- a set narrows as its
 * atoms go, and says so, rather than silently pointing somewhere else.
 */
import type { StructureDoc } from '../model/structure';

export interface NamedSelection {
  name: string;
  /** the atoms, by uid, in the order they were selected */
  uids: readonly string[];
}

export const NO_NAMED_SELECTIONS: readonly NamedSelection[] = [];

/**
 * `list` with `atoms` saved under `name`, replacing a set of that name if there is one (Avogadro
 * overwrites too). The name is trimmed; an empty one, or an empty selection, changes nothing.
 */
export function addNamed(
  list: readonly NamedSelection[],
  name: string,
  doc: StructureDoc,
  atoms: Iterable<number>,
): readonly NamedSelection[] {
  const trimmed = name.trim();
  const uids = [...atoms].map((i) => doc.atoms[i]?.uid).filter((u): u is string => !!u);
  if (!trimmed || uids.length === 0) return list;
  const entry: NamedSelection = { name: trimmed, uids };
  const at = list.findIndex((s) => s.name === trimmed);
  if (at < 0) return [...list, entry];
  return list.map((s, i) => (i === at ? entry : s));
}

/** `list` with `from` renamed to `to`; a name already taken, or an empty one, changes nothing. */
export function renameNamed(
  list: readonly NamedSelection[],
  from: string,
  to: string,
): readonly NamedSelection[] {
  const trimmed = to.trim();
  if (!trimmed || trimmed === from) return list;
  if (list.some((s) => s.name === trimmed)) return list;
  return list.map((s) => (s.name === from ? { ...s, name: trimmed } : s));
}

export function removeNamed(
  list: readonly NamedSelection[],
  name: string,
): readonly NamedSelection[] {
  return list.filter((s) => s.name !== name);
}

/** The atoms of `entry` that this document still has, as indices, in the document's order. */
export function resolveNamed(doc: StructureDoc, entry: NamedSelection): number[] {
  const wanted = new Set(entry.uids);
  const out: number[] = [];
  doc.atoms.forEach((a, i) => {
    if (a.uid && wanted.has(a.uid)) out.push(i);
  });
  return out;
}
