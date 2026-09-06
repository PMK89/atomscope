/**
 * Chemistry operations from the Extensions menu: send the current document to the stateless
 * backend and commit what comes back as one undoable step.
 *
 * Atom uids are carried over positionally so that a selection, a measurement or an undo entry
 * still refers to the same atoms after an operation that only moves them (optimize, charges).
 * Operations that add or remove atoms necessarily renumber, and the store handles that.
 */
import { api, type Body } from '../api/client';

/** The charge models the backend offers, as the route declares them. */
export type ChargeModel = Body<'/api/chem/partial-charges', 'post'>['model'];
import { toApiStructure } from '../api/structureBody';
import { normalizeStructure, withUids, type ApiStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

/** Run `call` on the current document and commit the result under `label`. */
export async function commitChemOp(
  label: string,
  call: (structure: ReturnType<typeof toApiStructure>) => Promise<ApiStructure>,
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

export const generate3d = (onError: (m: string) => void): Promise<boolean> =>
  commitChemOp(
    'Build 3D geometry',
    (structure) => api.chem.generate3d({ structure, add_hydrogens: true }),
    onError,
  );

export const perceiveBonds = (onError: (m: string) => void): Promise<boolean> =>
  commitChemOp(
    'Perceive bonds',
    (structure) => api.chem.perceiveBonds({ structure, bond_orders: true }),
    onError,
  );

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
        // the document's own constraints travel inside `structure`; the backend turns them into
        // force-field constraints itself, with the target values read off the geometry
        constraints: [],
      });
      return result.structure;
    },
    onError,
  );

export const assignPartialCharges = (
  onError: (m: string) => void,
  model: ChargeModel = 'gasteiger',
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
