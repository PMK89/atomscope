/**
 * Saving the open document into the project (Avogadro's File > Save / Save As).
 *
 * "Save as" writes a copy under a new id and continues editing the copy, which is what keeps a
 * derived structure -- a supercell, an optimized geometry -- from overwriting the one it came
 * from.
 */
import { api } from '../api/client';
import { newUid, type StructureDoc } from '../model/structure';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';

async function store(doc: StructureDoc): Promise<void> {
  await api.structures.put(doc);
  await useProjectStore.getState().refresh();
}

/** Save the open document over the structure it came from. */
export async function saveStructure(onError: (m: string) => void): Promise<boolean> {
  if (!useProjectStore.getState().info) {
    onError('Open a project before saving');
    return false;
  }
  const state = useStructureStore.getState();
  try {
    await store(state.doc);
    state.markSaved();
    return true;
  } catch (e) {
    onError(`Save failed: ${(e as Error).message}`);
    return false;
  }
}

/** Save the open document as a new structure and continue editing that one. */
export async function saveStructureAs(
  name: string,
  onError: (m: string) => void,
): Promise<boolean> {
  if (!useProjectStore.getState().info) {
    onError('Open a project before saving');
    return false;
  }
  const state = useStructureStore.getState();
  const copy: StructureDoc = { ...state.doc, id: newUid(), name: name || state.doc.name };
  try {
    await store(copy);
  } catch (e) {
    onError(`Save failed: ${(e as Error).message}`);
    return false;
  }
  // editing continues on the copy, history and all: a second Save must not go back to the original
  state.adoptIdentity({ id: copy.id, name: copy.name });
  return true;
}

/** File > Save as…: ask for a name, then save a copy under it. */
export async function promptSaveAs(onError: (m: string) => void): Promise<void> {
  const current = useStructureStore.getState().doc.name;
  const name = window.prompt('Save as', `${current} copy`);
  if (name !== null) await saveStructureAs(name.trim(), onError);
}
