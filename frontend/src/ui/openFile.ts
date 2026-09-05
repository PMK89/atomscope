/**
 * Opening a file the browser handed us: the one path shared by File ▸ Open…'s picker and by a file
 * dropped on the window, so both get the same format detection and the same document swap.
 */
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';

export async function openUploadedFile(file: File, format?: string): Promise<void> {
  const structure = await api.io.importUpload(file, format);
  useStructureStore.getState().load(normalizeStructure(structure));
}
