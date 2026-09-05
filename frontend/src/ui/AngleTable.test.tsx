import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { angleDeg, dihedralDeg } from '../model/geometry';
import { makeAtom, makeBond, normalizeStructure, type Vec3 } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { AngleTable, TorsionTable } from './AngleTable';

const doc = () =>
  normalizeStructure({
    name: 'part of ethane',
    atoms: [
      makeAtom('H', [-0.5, 1.0, 0]),
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.5, 0, 0]),
      makeAtom('H', [2.0, 0.5, 0.87]),
    ],
    bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 3)],
  } as never);

beforeEach(() => {
  useSelectionStore.getState().clear();
  useStructureStore.getState().load(doc());
});

const at = (i: number): Vec3 => useStructureStore.getState().doc.atoms[i]!.position as Vec3;

test('typing an angle turns the structure and is one undo step', () => {
  render(<AngleTable />);
  const field = screen.getByLabelText('value of H1—C2—C3');
  fireEvent.change(field, { target: { value: '109.50' } });
  fireEvent.blur(field);

  expect(angleDeg(at(0), at(1), at(2))).toBeCloseTo(109.5, 4);
  expect(useStructureStore.getState().undoStack.at(-1)?.label).toBe('Set angle');
});

test('typing a torsion turns about the central bond', () => {
  render(<TorsionTable />);
  const field = screen.getByLabelText('value of H1—C2—C3—H4');
  fireEvent.change(field, { target: { value: '180.00' } });
  fireEvent.blur(field);

  expect(dihedralDeg(at(0), at(1), at(2), at(3))).toBeCloseTo(180, 4);
  expect(useStructureStore.getState().undoStack.at(-1)?.label).toBe('Set torsion');
});

test('a value inside a ring is read-only, and says why', () => {
  useStructureStore.getState().load(
    normalizeStructure({
      name: 'ring',
      atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('C', [0.75, 1.3, 0])],
      bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 0)],
    } as never),
  );
  render(<AngleTable />);
  expect(screen.queryByLabelText(/value of/)).toBeNull();
  expect(screen.getByText(/turning one side would tear it open/)).toBeInTheDocument();
});

test('the tables narrow to the selection', () => {
  render(<AngleTable />);
  expect(screen.getAllByLabelText(/value of/)).toHaveLength(2);
  act(() => useSelectionStore.getState().set([0]));
  expect(screen.getAllByLabelText(/value of/)).toHaveLength(1);
  expect(screen.getByText(/Angles of the 1 selected/)).toBeInTheDocument();
});
