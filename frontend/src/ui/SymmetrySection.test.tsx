import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { prettySymbol, SymmetrySection } from './SymmetrySection';

const WATER = {
  id: 's1',
  name: 'water',
  atoms: [
    { element: 'O', position: [0, 0, 0.12] },
    { element: 'H', position: [0, 0.76, -0.47] },
    { element: 'H', position: [0, -0.76, -0.47] },
  ],
  bonds: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  useStructureStore.getState().load(normalizeStructure(WATER as never));
});

test('infinite groups are shown with the symbol chemists write', () => {
  expect(prettySymbol('C*v')).toBe('C∞v');
  expect(prettySymbol('D6h')).toBe('D6h');
});

test('detects the point group at the chosen tolerance', async () => {
  const pointGroup = vi
    .spyOn(api.chem, 'pointGroup')
    .mockResolvedValue({ symbol: 'C2v', order: 4, operations: ['E', 'C2', '2 sigma'] } as never);

  render(<SymmetrySection />);
  fireEvent.change(screen.getByLabelText('Tolerance'), { target: { value: 'loose' } });
  fireEvent.click(screen.getByText('Detect symmetry'));

  await waitFor(() => expect(screen.getByTestId('point-group').textContent).toContain('C2v'));
  expect(screen.getByTestId('point-group').textContent).toContain('order 4');
  expect(pointGroup).toHaveBeenCalledWith(expect.objectContaining({ tolerance: 'loose' }));
});

test('symmetrize commits the idealized geometry as one undo step', async () => {
  const moved = {
    ...WATER,
    atoms: [
      { element: 'O', position: [0, 0, 0.1] },
      { element: 'H', position: [0, 0.75, -0.45] },
      { element: 'H', position: [0, -0.75, -0.45] },
    ],
  };
  vi.spyOn(api.chem, 'symmetrize').mockResolvedValue(moved as never);
  vi.spyOn(api.chem, 'pointGroup').mockResolvedValue({
    symbol: 'C2v',
    order: 4,
    operations: ['E'],
  } as never);

  const before = useStructureStore.getState().doc.atoms.map((a) => a.uid);

  render(<SymmetrySection />);
  fireEvent.click(screen.getByText('Symmetrize'));

  await waitFor(() => expect(useStructureStore.getState().canUndo()).toBe(true));
  const doc = useStructureStore.getState().doc;
  expect(doc.atoms[0]!.position[2]).toBeCloseTo(0.1);
  // atom identities survive, so selections and the undo history still refer to the same atoms
  expect(doc.atoms.map((a) => a.uid)).toEqual(before);
  expect(useStructureStore.getState().undoLabel()).toBe('Symmetrize');
});

test('reports failures instead of throwing', async () => {
  vi.spyOn(api.chem, 'pointGroup').mockRejectedValue(new Error('too many atoms'));
  const onError = vi.fn();
  render(<SymmetrySection onError={onError} />);
  fireEvent.click(screen.getByText('Detect symmetry'));
  await waitFor(() => expect(onError).toHaveBeenCalledWith('too many atoms'));
});
