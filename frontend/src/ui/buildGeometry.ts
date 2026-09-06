/**
 * Offering a geometry for a file that was drawn rather than computed.
 *
 * Avogadro checked the dimension Open Babel reported for a file it had just read and asked
 * "This file does not contain 3D coordinates. Do you want Avogadro to build a rough geometry?"
 * (mainwindow.cpp:1120-1178). The offer is made here for the same reason: a flat molecule cannot
 * be measured, optimized or run, and the connection table is enough to build one from.
 *
 * Two differences from the reference, both deliberate. The dimension is read off the coordinates
 * rather than the file, because the readers here do not agree on how to report one and the model
 * carries no dimension. And answering No is not final: Build ▸ Generate 3D coordinates runs the
 * same edit later, and it is one undo step either way, where Avogadro's build was not undoable.
 * Avogadro's Yes-to-all/No-to-all are not offered: they belonged to its multi-molecule files,
 * which open here one structure at a time.
 */
import type { StructureDoc } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { generate3d } from './chemActions';

/** Whether the document looks like a drawing: bonded, big enough to have a shape, and flat. */
export function isFlat(doc: StructureDoc): boolean {
  return (
    doc.atoms.length >= 3 &&
    doc.bonds.length >= 1 &&
    doc.atoms.every((a) => Math.abs(a.position[2]) <= 1e-6)
  );
}

/**
 * Ask about the open document, and build if the answer is yes. Does nothing when it is not flat.
 */
export async function offerGeometry(onError: (m: string) => void): Promise<boolean> {
  const doc = useStructureStore.getState().doc;
  if (!isFlat(doc)) return false;
  const build = window.confirm(
    `${doc.name} has no 3D coordinates: every atom lies in one plane.\n\n` +
      'OK builds a rough geometry from the bonds and cleans it up with a force field. ' +
      'Cancel keeps the drawing; Build ▸ Generate 3D coordinates does it later.',
  );
  if (!build) return false;
  return generate3d(onError);
}
