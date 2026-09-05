/**
 * Chemistry operations from the Extensions menu: send the current document to the stateless
 * backend and commit what comes back as one undoable step.
 *
 * Atom uids are carried over positionally so that a selection, a measurement or an undo entry
 * still refers to the same atoms after an operation that only moves them (optimize, charges).
 * Operations that add or remove atoms necessarily renumber, and the store handles that.
 */
import { api, type FFConstraint, type Structure } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import { normalizeStructure, type StructureDoc } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

/** Run `call` on the current document and commit the result under `label`. */
export async function commitChemOp(
  label: string,
  call: (structure: ReturnType<typeof toApiStructure>) => Promise<Structure>,
  onError: (m: string) => void,
): Promise<boolean> {
  const doc = useStructureStore.getState().doc;
  try {
    const result = await call(toApiStructure(doc));
    useStructureStore.getState().commit(label, withUids(normalizeStructure(result), doc));
    return true;
  } catch (e) {
    onError(`${label} failed: ${(e as Error).message}`);
    return false;
  }
}

/** Keep the previous atom identities when the operation returned the same atoms in order. */
export function withUids(next: StructureDoc, previous: StructureDoc): StructureDoc {
  if (next.atoms.length !== previous.atoms.length) return next;
  if (next.atoms.some((a, i) => a.element !== previous.atoms[i]?.element)) return next;
  return {
    ...next,
    id: previous.id,
    atoms: next.atoms.map((a, i) => {
      const uid = previous.atoms[i]?.uid;
      return uid ? { ...a, uid } : a;
    }),
  };
}

/** Selected atom indices, or undefined when nothing is selected (the backend then takes all). */
export function selectedIndices(): number[] | undefined {
  const atoms = [...useSelectionStore.getState().atoms].sort((a, b) => a - b);
  return atoms.length > 0 ? atoms : undefined;
}

export const addHydrogens = (onError: (m: string) => void, ph?: number): Promise<boolean> =>
  commitChemOp(
    ph === undefined ? 'Add hydrogens' : `Add hydrogens (pH ${ph})`,
    (structure) =>
      api.chem.addHydrogens({
        structure,
        ...(selectedIndices() ? { indices: selectedIndices()! } : {}),
        ...(ph === undefined ? {} : { ph }),
      }),
    onError,
  );

export const removeHydrogens = (onError: (m: string) => void): Promise<boolean> =>
  commitChemOp(
    'Remove hydrogens',
    (structure) =>
      api.chem.removeHydrogens({
        structure,
        ...(selectedIndices() ? { indices: selectedIndices()! } : {}),
      }),
    onError,
  );

export const perceiveBonds = (onError: (m: string) => void): Promise<boolean> =>
  commitChemOp(
    'Perceive bonds',
    (structure) => api.chem.perceiveBonds({ structure, bond_orders: true }),
    onError,
  );

/**
 * The document's constraints as force-field constraints. A `fix_cartesian` with a partial mask
 * becomes the per-axis kinds Open Babel understands, so a plane-constrained atom is not silently
 * optimized as if it were free.
 */
export function forceFieldConstraints(doc: StructureDoc): FFConstraint[] {
  const out: FFConstraint[] = [];
  for (const c of doc.constraints ?? []) {
    if (c.kind === 'fix_atoms') out.push({ kind: 'fix', atoms: [...c.indices] });
    else if (c.kind === 'fix_bond_length') out.push({ kind: 'distance', atoms: [c.a, c.b] });
    else if (c.kind === 'fix_cartesian') {
      const axes = ['fix_x', 'fix_y', 'fix_z'] as const;
      const fixed = c.mask.flatMap((m, i) => (m ? [axes[i]!] : []));
      if (fixed.length === 3) out.push({ kind: 'fix', atoms: [c.index] });
      else for (const kind of fixed) out.push({ kind, atoms: [c.index] });
    }
  }
  return out;
}

export const optimizeGeometry = (
  onError: (m: string) => void,
  forceField = 'MMFF94',
): Promise<boolean> =>
  commitChemOp(
    `Optimize (${forceField})`,
    async (structure) => {
      const result = await api.chem.optimize({
        structure,
        force_field: forceField,
        algorithm: 'steepest_descent',
        max_steps: 500,
        convergence: 1e-6,
        record_every: 0,
        constraints: forceFieldConstraints(useStructureStore.getState().doc),
      });
      return result.structure;
    },
    onError,
  );

export const assignPartialCharges = (
  onError: (m: string) => void,
  model = 'gasteiger',
): Promise<boolean> =>
  commitChemOp(
    `Partial charges (${model})`,
    async (structure) => (await api.chem.partialCharges({ structure, model })).structure,
    onError,
  );

export const invertChirality = (onError: (m: string) => void): Promise<boolean> =>
  commitChemOp(
    'Invert chirality',
    (structure) =>
      api.chem.invertChirality({
        structure,
        ...(selectedIndices() ? { indices: selectedIndices()! } : {}),
      }),
    onError,
  );

export const hydrogenToMethyl = (onError: (m: string) => void): Promise<boolean> =>
  commitChemOp(
    'Hydrogen to methyl',
    (structure) =>
      api.chem.hToMethyl({
        structure,
        ...(selectedIndices() ? { indices: selectedIndices()! } : {}),
      }),
    onError,
  );

/** Copy the molecule's SMILES or InChI to the clipboard (Avogadro's Edit > Copy As). */
export async function copyIdentifier(
  kind: 'smiles' | 'inchi' | 'inchikey',
  onError: (m: string) => void,
  notify: (m: string) => void,
): Promise<void> {
  try {
    const doc = useStructureStore.getState().doc;
    const ids = await api.chem.identifiers({ structure: toApiStructure(doc) });
    const text = ids[kind];
    if (!text) {
      onError(`No ${kind} for this structure`);
      return;
    }
    await navigator.clipboard.writeText(text);
    notify(`Copied ${text}`);
  } catch (e) {
    onError(`Copy ${kind} failed: ${(e as Error).message}`);
  }
}
