/**
 * What a label says (Avogadro 1's Label engine settings).
 *
 * Kept separate from the layer that draws it: the text of a label is a property of the structure
 * and is worth testing on its own, while drawing needs a canvas.
 */
import { elementBySymbol } from '../model/elements';
import type { StructureDoc } from '../model/structure';

export type AtomLabelContent =
  | 'none'
  | 'index'
  | 'symbol'
  | 'symbol_index'
  | 'formal_charge'
  | 'partial_charge'
  | 'residue_name'
  | 'residue_number'
  | 'uid'
  | 'custom';

export type BondLabelContent = 'none' | 'length' | 'index' | 'order';

export const ATOM_LABEL_OPTIONS: { id: AtomLabelContent; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'index', label: 'Atom number' },
  { id: 'symbol', label: 'Element symbol' },
  { id: 'symbol_index', label: 'Symbol & atom number' },
  { id: 'formal_charge', label: 'Formal charge' },
  { id: 'partial_charge', label: 'Partial charge' },
  { id: 'residue_name', label: 'Residue name' },
  { id: 'residue_number', label: 'Residue number' },
  { id: 'uid', label: 'Unique ID' },
  { id: 'custom', label: 'Custom (atom label)' },
];

export const BOND_LABEL_OPTIONS: { id: BondLabelContent; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'length', label: 'Bond length' },
  { id: 'index', label: 'Bond number' },
  { id: 'order', label: 'Bond order' },
];

/** Partial charges, from whichever scalar property carries them; empty when there are none. */
export function partialCharges(doc: StructureDoc): readonly number[] {
  for (const key of ['partial_charges', 'charges', 'mulliken_charges']) {
    const property = doc.atomic_scalars?.[key];
    if (property && property.values.length === doc.atoms.length) return property.values;
  }
  return [];
}

/** Residue of each atom, by index; a sparse map because most structures have none. */
export function residueOfAtom(doc: StructureDoc): Map<number, { name: string; number: number }> {
  const out = new Map<number, { name: string; number: number }>();
  (doc.residues ?? []).forEach((r, i) => {
    for (const atom of r.atom_indices ?? []) {
      out.set(atom, { name: r.name ?? '', number: r.number ?? i + 1 });
    }
  });
  return out;
}

/** The text for one atom, or '' when the option has nothing to show for it. */
export function atomLabel(
  doc: StructureDoc,
  index: number,
  content: AtomLabelContent,
  charges: readonly number[] = partialCharges(doc),
  residues: Map<number, { name: string; number: number }> = residueOfAtom(doc),
): string {
  const atom = doc.atoms[index];
  if (!atom || content === 'none') return '';
  switch (content) {
    case 'index':
      return String(index + 1);
    case 'symbol':
      return atom.element;
    case 'symbol_index':
      return `${atom.element}${index + 1}`;
    case 'formal_charge':
      // an uncharged atom is not worth a label of its own
      return atom.formal_charge ? formatCharge(atom.formal_charge) : '';
    case 'partial_charge': {
      const q = charges[index];
      return q === undefined ? '' : q.toFixed(2);
    }
    case 'residue_name':
      return residues.get(index)?.name ?? '';
    case 'residue_number': {
      const residue = residues.get(index);
      return residue ? String(residue.number) : '';
    }
    case 'uid':
      return atom.uid ?? '';
    case 'custom':
      return atom.label ?? '';
    default:
      return '';
  }
}

/** The text for one bond. Lengths are Angstrom, to two decimals as Avogadro shows them. */
export function bondLabel(doc: StructureDoc, index: number, content: BondLabelContent): string {
  const bond = doc.bonds[index];
  if (!bond || content === 'none') return '';
  if (content === 'index') return String(index + 1);
  if (content === 'order') return bond.aromatic ? 'ar' : String(bond.order);
  const a = doc.atoms[bond.a];
  const b = doc.atoms[bond.b];
  if (!a || !b) return '';
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  ).toFixed(2);
}

/** "+2" / "-" / "2-" the way chemists write a formal charge. */
export function formatCharge(charge: number): string {
  const sign = charge > 0 ? '+' : '-';
  return Math.abs(charge) === 1 ? sign : `${Math.abs(charge)}${sign}`;
}

/** Where the label sits: at the atom, offset out of the sphere so text is not buried in it. */
export function atomLabelOffset(element: string, style: 'small' | 'vdw'): number {
  const data = elementBySymbol(element);
  const radius = style === 'vdw' ? data.vdwRadius || data.covalentRadius * 2 : 0.3;
  return radius;
}
