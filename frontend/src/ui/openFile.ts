/**
 * Opening a file the browser handed us: the one path shared by File ▸ Open…'s picker and by a file
 * dropped on the window, so both get the same format detection and the same document swap.
 */
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { offerGeometry } from './buildGeometry';
import { confirmReplace } from './replaceDocument';

/** False when the open document has unsaved work and the user chose to keep it. */
export async function openUploadedFile(
  file: File,
  onError: (m: string) => void,
  format?: string,
): Promise<boolean> {
  if (!confirmReplace()) return false;
  const structure = await api.io.importUpload(file, format);
  useStructureStore.getState().load(normalizeStructure(structure));
  await offerGeometry(onError);
  return true;
}
