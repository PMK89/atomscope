/**
 * One round of interactive optimization: the document goes to the backend, a few steps of the
 * force field come back. The document's own constraints travel inside the structure, so only the
 * atoms the user is holding are added as `fixed_atoms`.
 */
import { api } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import { normalizeStructure, withUids, type StructureDoc } from '../model/structure';

export interface StepOptions {
  forceField: string;
  algorithm: 'steepest_descent' | 'conjugate_gradients';
  steps: number;
  /** atoms the user is dragging: pinned for this round */
  fixed: readonly number[];
}

export interface StepResult {
  doc: StructureDoc;
  converged: boolean;
  /** total energy in the unit the backend reports */
  energy: number;
  unit: string;
}

export async function optimizeStep(doc: StructureDoc, opts: StepOptions): Promise<StepResult> {
  const res = await api.chem.optimizeStep({
    structure: toApiStructure(doc),
    force_field: opts.forceField,
    algorithm: opts.algorithm,
    steps: opts.steps,
    fixed_atoms: [...opts.fixed],
    constraints: [],
  });
  return {
    // the atoms come back in the same order, so the uids (and the selection) survive
    doc: withUids(normalizeStructure(res.structure), doc),
    converged: res.converged,
    energy: res.energy.value,
    unit: res.energy.unit,
  };
}
