import type { Body } from './client';
import type { StructureDoc } from '../model/structure';

/** The request-body shape every structure-taking route shares. */
export type ApiStructureBody = Body<'/api/chem/point-group', 'post'>['structure'];

/** The document as the backend expects it; derived fields the API recomputes are left out. */
export const toApiStructure = (doc: StructureDoc): ApiStructureBody => ({
  id: doc.id,
  name: doc.name,
  atoms: doc.atoms,
  bonds: doc.bonds,
  cell: doc.cell,
  charge: doc.charge,
  multiplicity: doc.multiplicity,
  constraints: doc.constraints,
  residues: doc.residues,
});
