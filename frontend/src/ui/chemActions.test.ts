import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import {
  addHydrogens,
  forceFieldConstraints,
  copyIdentifier,
  optimizeGeometry,
  removeHydrogens,
  selectedIndices,
  withUids,
} from './chemActions';

function water() {
  return normalizeStructure({
    name: 'water',
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [0, 0.8, 0.5]), makeAtom('H', [0, -0.8, 0.5])],
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  useSelectionStore.getState().clear();
  useStructureStore.getState().load(water());
});

test('an operation that only moves atoms keeps their identities', () => {
  const before = water();
  const moved = normalizeStructure({
    name: 'water',
    atoms: before.atoms.map((a) => ({ ...a, uid: undefined, position: [0, 0, 1] })),
  } as never);
  const merged = withUids(moved, before);
  expect(merged.atoms.map((a) => a.uid)).toEqual(before.atoms.map((a) => a.uid));
  expect(merged.id).toBe(before.id);
});

test('an operation that adds atoms renumbers instead of reusing identities', () => {
  const before = water();
  const grown = normalizeStructure({
    name: 'water',
    atoms: [...before.atoms.map((a) => ({ ...a, uid: undefined })), makeAtom('H', [1, 0, 0])],
  } as never);
  expect(withUids(grown, before).atoms).toHaveLength(4);
  expect(withUids(grown, before).atoms[0]!.uid).not.toBe(before.atoms[0]!.uid);
});

test('optimize commits the returned geometry as one undo step', async () => {
  const relaxed = { ...water(), atoms: water().atoms.map((a) => ({ ...a, position: [1, 1, 1] })) };
  vi.spyOn(api.chem, 'optimize').mockResolvedValue({
    structure: relaxed,
    energy: { value: -1, unit: 'kcal/mol' },
    steps: 12,
    converged: true,
  } as never);

  expect(await optimizeGeometry(() => {})).toBe(true);
  expect(useStructureStore.getState().undoLabel()).toBe('Optimize (MMFF94)');
  expect(useStructureStore.getState().doc.atoms[0]!.position).toEqual([1, 1, 1]);
});

test('hydrogen operations act on the selection when there is one', async () => {
  const remove = vi.spyOn(api.chem, 'removeHydrogens').mockResolvedValue(water() as never);
  useSelectionStore.getState().set([2, 1]);
  expect(selectedIndices()).toEqual([1, 2]);

  await removeHydrogens(() => {});
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ indices: [1, 2] }));

  useSelectionStore.getState().clear();
  const add = vi.spyOn(api.chem, 'addHydrogens').mockResolvedValue(water() as never);
  await addHydrogens(() => {}, 7.4);
  const body = add.mock.calls[0]![0] as Record<string, unknown>;
  expect(body.ph).toBe(7.4);
  expect(body).not.toHaveProperty('indices');
});

test('a failed operation reports and leaves the document alone', async () => {
  vi.spyOn(api.chem, 'perceiveBonds');
  vi.spyOn(api.chem, 'optimize').mockRejectedValue(new Error('no force field'));
  const onError = vi.fn();
  const before = useStructureStore.getState().doc;

  expect(await optimizeGeometry(onError)).toBe(false);
  expect(onError).toHaveBeenCalledWith('Optimize (MMFF94) failed: no force field');
  expect(useStructureStore.getState().doc).toBe(before);
});

test('copy as SMILES puts the identifier on the clipboard', async () => {
  vi.spyOn(api.chem, 'identifiers').mockResolvedValue({
    smiles: 'O',
    inchi: 'InChI=1S/H2O/h1H2',
    inchikey: 'XLYOFNOQVPJJNP-UHFFFAOYSA-N',
  } as never);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const notify = vi.fn();

  await copyIdentifier('smiles', () => {}, notify);
  expect(writeText).toHaveBeenCalledWith('O');
  expect(notify).toHaveBeenCalledWith('Copied O');
});

test('document constraints reach the force field', () => {
  const doc = {
    ...water(),
    constraints: [
      { kind: 'fix_atoms', indices: [0] },
      { kind: 'fix_cartesian', index: 1, mask: [true, false, true] },
      { kind: 'fix_cartesian', index: 2, mask: [true, true, true] },
      { kind: 'fix_bond_length', a: 0, b: 1 },
    ],
  } as never;
  expect(forceFieldConstraints(doc)).toEqual([
    { kind: 'fix', atoms: [0] },
    { kind: 'fix_x', atoms: [1] },
    { kind: 'fix_z', atoms: [1] },
    { kind: 'fix', atoms: [2] },
    { kind: 'distance', atoms: [0, 1] },
  ]);
  expect(forceFieldConstraints(water())).toEqual([]);
});

test('optimize passes the constraints instead of dropping them', async () => {
  const optimize = vi.spyOn(api.chem, 'optimize').mockResolvedValue({
    structure: water(),
    energy: { value: -1, unit: 'kcal/mol' },
    steps: 1,
    converged: true,
  } as never);
  useStructureStore.getState().commit('fix', {
    ...useStructureStore.getState().doc,
    constraints: [{ kind: 'fix_atoms', indices: [0] }],
  } as never);

  await optimizeGeometry(() => {});
  expect(optimize).toHaveBeenCalledWith(
    expect.objectContaining({ constraints: [{ kind: 'fix', atoms: [0] }] }),
  );
});
