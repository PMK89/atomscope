/**
 * The dipole moment a set of partial charges implies: Σ qᵢ rᵢ, in Debye.
 *
 * Derived, never stored. Avogadro did the same thing for the same reason (molecule.cpp:772-796):
 * a dipole read from an output file is a measurement and is kept, but the one that follows from
 * the charges is recomputed whenever the geometry or the charges change, because a stored copy
 * would be wrong the moment an atom moves. Nothing here can take the first branch: the output
 * importer keeps only the *magnitude* of a computed dipole (io/qc_outputs.py), so what is drawn
 * is always the estimate from the charges.
 *
 * The sign is the physics convention -- the vector points from negative toward positive charge,
 * which is what the backend's `Dipole.vector` reports. Avogadro's arrow pointed the other way
 * (it multiplied by a negative factor, "to go from positive to negative charge (Chemistry)").
 */
import { centroid, partialChargeKey, type StructureDoc, type Vec3 } from './structure';

/** e·Å to Debye, the factor the backend converts with (atomscope.units, via ASE). */
export const E_ANGSTROM_TO_DEBYE = 4.803204672997659;

export interface Dipole {
  /** Debye */
  vector: Vec3;
  magnitude: number;
  /** where to draw it from: the centre of the atoms it was summed over */
  origin: Vec3;
}

/** Null when the structure carries no partial charges, which is when there is nothing to draw. */
export function dipoleFromCharges(doc: StructureDoc): Dipole | null {
  const key = partialChargeKey(doc);
  if (!key || doc.atoms.length === 0) return null;
  const charges = doc.atomic_scalars[key]!.values;
  const vector: Vec3 = [0, 0, 0];
  doc.atoms.forEach((atom, i) => {
    const q = charges[i] ?? 0;
    vector[0] += q * atom.position[0];
    vector[1] += q * atom.position[1];
    vector[2] += q * atom.position[2];
  });
  const debye = vector.map((x) => x * E_ANGSTROM_TO_DEBYE) as Vec3;
  const magnitude = Math.hypot(...debye);
  return { vector: debye, magnitude, origin: centroid(doc) };
}
