/**
 * Fragments: the piece of a document that a selection describes, and how one is put back.
 *
 * Copy and paste stay inside the document model. Serializing a fragment through a chemical file
 * format and reading it back would go through bond perception and RDKit sanitization, which adds
 * hydrogens to the atoms on the cut boundary and rejects perfectly ordinary metal centres -- a
 * fragment is already fully specified here, so it is carried as such. XYZ text is written for the
 * system clipboard so that other programs get something, not so that Atomscope can read it back.
 */
import type { StructureDoc, Vec3 } from '../model/structure';
import { emptyStructure, newUid } from '../model/structure';

/** The selected atoms and the bonds between them, re-indexed to stand on their own. */
export function selectionFragment(doc: StructureDoc, selected: Iterable<number>): StructureDoc {
  const wanted = [...new Set(selected)].sort((a, b) => a - b).filter((i) => !!doc.atoms[i]);
  const index = new Map(wanted.map((atom, k) => [atom, k]));
  const frag = emptyStructure(doc.name);
  frag.atoms = wanted.map((i) => ({ ...doc.atoms[i]! }));
  frag.bonds = doc.bonds
    .filter((b) => index.has(b.a) && index.has(b.b))
    .map((b) => ({ ...b, a: index.get(b.a)!, b: index.get(b.b)! }));
  frag.cell = doc.cell;
  frag.charge = 0;
  // a copied peptide keeps its residues, or the paste would have no backbone to label or draw
  frag.residues = doc.residues
    .map((r) => ({
      ...r,
      atom_indices: r.atom_indices.map((i) => index.get(i) ?? -1).filter((i) => i >= 0),
    }))
    .filter((r) => r.atom_indices.length > 0);
  return frag;
}

/**
 * Append `fragment` to `doc`, optionally displaced. The pasted atoms get new identities: pasting
 * a fragment twice must not produce two atoms claiming to be the same one.
 */
export function mergeFragment(
  doc: StructureDoc,
  fragment: StructureDoc,
  offset: Vec3 = [0, 0, 0],
): { doc: StructureDoc; added: number[] } {
  const base = doc.atoms.length;
  const atoms = fragment.atoms.map((a) => ({
    ...a,
    uid: newUid(),
    position: [
      a.position[0]! + offset[0],
      a.position[1]! + offset[1],
      a.position[2]! + offset[2],
    ] as Vec3,
  }));
  const bonds = fragment.bonds.map((b) => ({ ...b, a: b.a + base, b: b.b + base }));
  const residues = fragment.residues.map((r) => ({
    ...r,
    atom_indices: r.atom_indices.map((i) => i + base),
  }));
  return {
    doc: {
      ...doc,
      atoms: [...doc.atoms, ...atoms],
      bonds: [...doc.bonds, ...bonds],
      residues: [...doc.residues, ...residues],
    },
    added: atoms.map((_, k) => base + k),
  };
}

/** XYZ text for the system clipboard: what every other chemistry program understands. */
export function toXyz(doc: StructureDoc, comment = doc.name): string {
  const lines = [String(doc.atoms.length), comment.replace(/[\r\n]+/g, ' ')];
  for (const a of doc.atoms) {
    const [x, y, z] = a.position;
    lines.push(`${a.element} ${x!.toFixed(6)} ${y!.toFixed(6)} ${z!.toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}
