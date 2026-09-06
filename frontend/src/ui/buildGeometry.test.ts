import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { isFlat, offerGeometry } from './buildGeometry';
import { api } from '../api/client';

const drawing = () =>
  normalizeStructure({
    name: 'sketch',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.4, 0, 0]), makeAtom('O', [2.1, 1.2, 0])],
    bonds: [makeBond(0, 1), makeBond(1, 2)],
  } as never);

const built = {
  name: 'sketch',
  charge: 0,
  atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.4, 0, 0.3]), makeAtom('O', [2.1, 1.2, 0.9])],
  bonds: [makeBond(0, 1), makeBond(1, 2)],
};

beforeEach(() => {
  useStructureStore.getState().load(drawing());
});
afterEach(() => vi.restoreAllMocks());

test('a flat document is one that was drawn, not one that is small or unbonded', () => {
  expect(isFlat(drawing())).toBe(true);
  const tilted = normalizeStructure({
    ...drawing(),
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.4, 0, 0.5]), makeAtom('O', [2.1, 1.2, 0])],
  } as never);
  expect(isFlat(tilted)).toBe(false);
  expect(isFlat(normalizeStructure({ ...drawing(), bonds: [] } as never))).toBe(false);
  const pair = normalizeStructure({
    name: 'h2',
    atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [0.74, 0, 0])],
    bonds: [makeBond(0, 1)],
  } as never);
  expect(isFlat(pair)).toBe(false);
});

test('the offer builds when it is accepted, as one undo step', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const generate = vi.spyOn(api.chem, 'generate3d').mockResolvedValue(built as never);
  const errors: string[] = [];

  expect(await offerGeometry((m) => errors.push(m))).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(errors).toEqual([]);
  const state = useStructureStore.getState();
  expect(state.undoStack.at(-1)?.label).toBe('Build 3D geometry');
  expect(isFlat(state.doc)).toBe(false);
  // one step: undo returns the drawing
  state.undo();
  expect(isFlat(useStructureStore.getState().doc)).toBe(true);
});

test('the drawing is kept when the offer is declined, and nothing is asked of a 3D file', async () => {
  const generate = vi.spyOn(api.chem, 'generate3d');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(await offerGeometry(() => undefined)).toBe(false);
  expect(generate).not.toHaveBeenCalled();
  expect(isFlat(useStructureStore.getState().doc)).toBe(true);

  useStructureStore.getState().load(normalizeStructure(built as never));
  confirm.mockClear();
  expect(await offerGeometry(() => undefined)).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});

test('a build that fails leaves the drawing and says so', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(api.chem, 'generate3d').mockRejectedValue(new Error('no force field'));
  const errors: string[] = [];
  expect(await offerGeometry((m) => errors.push(m))).toBe(false);
  expect(errors[0]).toMatch(/Build 3D geometry failed: no force field/);
  expect(isFlat(useStructureStore.getState().doc)).toBe(true);
});
