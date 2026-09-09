import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach } from 'vitest';

import copper from '../../model/__fixtures__/copper-md.json';
import { trajectoryFromJson, type ApiTrajectory } from '../../model/trajectory';
import { useSelectionStore } from '../../state/selectionStore';
import { useTrajectoryStore } from '../../state/trajectoryStore';
import { DynamicsView } from './DynamicsView';

const initial = useTrajectoryStore.getState();

beforeEach(() => {
  useTrajectoryStore.setState(initial, true);
  useSelectionStore.getState().clear();
});

const loadCopper = (): void =>
  useTrajectoryStore.getState().load(trajectoryFromJson(copper as unknown as ApiTrajectory));

/** Two elements and a time axis, so "one curve per element" has something to split. */
function loadWater(withTime = true): void {
  useTrajectoryStore.getState().loadFromResult({
    trajectory: {
      id: 'w',
      name: 'water md',
      kind: 'md',
      structure_id: null,
      symbols: ['O', 'H', 'H'],
      frames: [0, 1, 2, 3].map((i) => ({
        positions: [
          [0, 0, 0],
          [0.96 + 0.01 * i, 0, 0],
          [-0.24, 0.93 + 0.01 * i, 0],
        ],
        cell: null,
        energy: null,
        time: withTime ? i : null,
        temperature: null,
        step: i,
      })),
    } as unknown as ApiTrajectory,
  });
}

const polylines = (container: HTMLElement): number => container.querySelectorAll('polyline').length;

/** The chart's own caption. `getByText` would also match the <select> option of the same name. */
const chartTitle = (container: HTMLElement): string | null =>
  container.querySelector('.chart-title')?.textContent ?? null;

test('offers to load the calculation trajectory when none is loaded', () => {
  render(<DynamicsView calcId="calc-1" />);
  expect(screen.getByText(/No trajectory loaded/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load trajectory' })).toBeInTheDocument();
});

test('plots the group temperature of the loaded trajectory', () => {
  loadCopper();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  expect(screen.getByText(/14 frames · 4 atoms/, { selector: 'p' })).toBeInTheDocument();
  expect(chartTitle(container)).toBe('Group temperature');
  expect(polylines(container)).toBeGreaterThan(0);
  expect(screen.getByLabelText('Atoms')).toHaveValue('all');
});

test('splits the temperature into one curve per element', () => {
  loadWater();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Atoms'), { target: { value: 'element' } });
  expect(screen.getByText('H')).toBeInTheDocument();
  expect(screen.getByText('O')).toBeInTheDocument();
  // two groups, two curves
  expect(polylines(container)).toBe(2);
});

test('restricts the group to chosen indices', () => {
  loadCopper();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Atoms'), { target: { value: 'indices' } });
  fireEvent.change(screen.getByLabelText('Indices'), { target: { value: '0-1' } });
  expect(polylines(container)).toBe(1);
  // the two-atom group runs hotter than the whole cell, so this is not the all-atoms curve
  const y = container.querySelector('polyline')?.getAttribute('points');
  fireEvent.change(screen.getByLabelText('Atoms'), { target: { value: 'all' } });
  expect(container.querySelector('polyline')?.getAttribute('points')).not.toBe(y);
});

test('names the running average time constant on the chart', () => {
  loadCopper();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  expect(chartTitle(container)).toBe('Group temperature');
  fireEvent.change(screen.getByLabelText(/Running average/), { target: { value: '4' } });
  // Figs 5.3-5.5 differ by the averaging window alone, so the chart has to say which it is
  expect(chartTitle(container)).toBe('Group temperature · τ 4 fs');
});

test('smooths the curve it labels', () => {
  loadCopper();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  const raw = container.querySelector('polyline')?.getAttribute('points');
  fireEvent.change(screen.getByLabelText(/Running average/), { target: { value: '40' } });
  expect(container.querySelector('polyline')?.getAttribute('points')).not.toBe(raw);
});

test('says why a trajectory without times has no temperature', () => {
  loadWater(false);
  const { container } = render(<DynamicsView calcId="calc-1" />);
  expect(screen.getByText(/no time axis/, { selector: 'p.muted' })).toBeInTheDocument();
  expect(screen.getByText(/cannot be formed/, { selector: 'p.form-error' })).toBeInTheDocument();
  expect(polylines(container)).toBe(0);
});

test('plots a mode and grows the inputs its kind needs', () => {
  loadCopper();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  expect(screen.getByLabelText('Term 1 atom 2')).toBeInTheDocument();
  expect(screen.queryByLabelText('Term 1 atom 3')).not.toBeInTheDocument();
  expect(polylines(container)).toBe(1);

  fireEvent.change(screen.getByLabelText('Term 1 kind'), { target: { value: 'torsion' } });
  expect(screen.getByLabelText('Term 1 atom 4')).toBeInTheDocument();
  expect(polylines(container)).toBe(1);
});

test('builds a difference coordinate from two scaled terms', () => {
  loadCopper();
  render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add term' }));
  fireEvent.change(screen.getByLabelText('Term 2 atom 2'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Term 2 scale'), { target: { value: '-1' } });
  expect(screen.getByLabelText('Term 2 scale')).toHaveValue(-1);
  // both terms are bonds, so the mode keeps their unit
  expect(screen.getByText('Å')).toBeInTheDocument();
});

test('takes a term from the viewport selection, and says what it needs', () => {
  loadCopper();
  render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  act(() => useSelectionStore.getState().set([2]));
  fireEvent.click(screen.getByRole('button', { name: 'Add from selection' }));
  expect(
    screen.getByText(/Select two, three or four atoms/, { selector: 'p' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Term 2 kind')).not.toBeInTheDocument();

  act(() => useSelectionStore.getState().set([1, 2, 3]));
  fireEvent.click(screen.getByRole('button', { name: 'Add from selection' }));
  expect(screen.getByLabelText('Term 2 kind')).toHaveValue('angle');
  expect(screen.getByLabelText('Term 2 atom 3')).toHaveValue(3);
});

test('marks a term whose atoms are out of range and leaves it out of the sum', () => {
  loadWater();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  fireEvent.change(screen.getByLabelText('Term 1 atom 2'), { target: { value: '9' } });
  expect(container.querySelector('tr.row-invalid')).not.toBeNull();
  expect(screen.getByText('Nothing to plot yet.')).toBeInTheDocument();
});

test('removes a term', () => {
  loadCopper();
  render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove term 1' }));
  expect(screen.queryByLabelText('Term 1 kind')).not.toBeInTheDocument();
  expect(screen.getByText('Nothing to plot yet.')).toBeInTheDocument();
});

test('plots the time derivative of the mode with its own unit', () => {
  loadCopper();
  render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  fireEvent.click(screen.getByLabelText('Plot the time derivative'));
  expect(screen.getByText('Å/fs')).toBeInTheDocument();
});

test('warns that a subsampled trajectory understates the temperature', () => {
  loadCopper();
  const { container } = render(<DynamicsView calcId="calc-1" />);
  expect(screen.queryByText(/lower bound/)).not.toBeInTheDocument();

  // the same frames, relabelled as every tenth step of the propagation
  const t = useTrajectoryStore.getState().trajectory!;
  act(() => {
    useTrajectoryStore.getState().load({
      ...t,
      step: Float64Array.from(t.step, (v) => v * 10),
    });
  });
  expect(screen.getByText(/every 10 steps/, { selector: 'p.muted' })).toBeInTheDocument();
  expect(screen.getByText(/across 20 steps/, { selector: 'p.muted' })).toBeInTheDocument();
  // it is a note, not a refusal: the curve is still drawn
  expect(polylines(container)).toBeGreaterThan(0);
});

test('calls the mode running average window frames when there is no time axis', () => {
  loadWater(false);
  render(<DynamicsView calcId="calc-1" />);
  fireEvent.change(screen.getByLabelText('Series'), { target: { value: 'mode' } });
  expect(screen.getByLabelText('Running average τ (frames)')).toBeInTheDocument();
  expect(screen.getByText('frame')).toBeInTheDocument();
});
