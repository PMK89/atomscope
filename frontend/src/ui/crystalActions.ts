/**
 * Crystal operations: call the stateless backend with the current document and commit the
 * returned structure as one undoable step.
 */
import { api, type Structure } from '../api/client';
import { normalizeStructure, type StructureDoc } from '../model/structure';
import { useStructureStore } from '../state/structureStore';

export type StructureRequest = { structure: StructureDoc };

/** Run `call` on the current document and commit the result under `label`; errors go to `onError`. */
export async function commitCrystalOp(
  label: string,
  call: (doc: StructureDoc) => Promise<Structure>,
  onError: (m: string) => void,
): Promise<boolean> {
  const st = useStructureStore.getState();
  try {
    const result = await call(st.doc);
    useStructureStore.getState().commit(label, normalizeStructure(result));
    return true;
  } catch (e) {
    onError(`${label} failed: ${(e as Error).message}`);
    return false;
  }
}

export function toggleCell(onError: (m: string) => void): Promise<boolean> {
  const hasCell = Boolean(useStructureStore.getState().doc.cell);
  return hasCell
    ? commitCrystalOp(
        'Remove unit cell',
        (structure) => api.crystal.removeCell({ structure }),
        onError,
      )
    : commitCrystalOp(
        'Add unit cell',
        (structure) => api.crystal.addCell({ structure, padding: 5 }),
        onError,
      );
}
