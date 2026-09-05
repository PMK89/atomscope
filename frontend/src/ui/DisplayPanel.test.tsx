import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { useViewStore } from '../state/viewStore';
import { DisplayPanel } from './DisplayPanel';

beforeEach(() => {
  useViewStore.setState({
    style: 'ball-and-stick',
    selectionStyle: null,
    showLabels: false,
    atomLabels: 'symbol_index',
    bondLabels: 'none',
    labelShift: [0, 0, 0],
    showVectors: false,
    showUnitCell: false,
    showAxes: false,
  });
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'c', atoms: [makeAtom('C', [0, 0, 0])] } as never));
});

test('the panel drives the display settings the renderer reads', () => {
  render(<DisplayPanel />);

  fireEvent.change(screen.getByLabelText('Display type'), { target: { value: 'vdw' } });
  expect(useViewStore.getState().style).toBe('vdw');

  fireEvent.change(screen.getByLabelText('Atom radius'), { target: { value: '0.6' } });
  expect(useViewStore.getState().atomScale).toBe(0.6);

  fireEvent.click(screen.getByLabelText('Show axes'));
  expect(useViewStore.getState().showAxes).toBe(true);
});

test('the selection can be given its own display type', () => {
  render(<DisplayPanel />);
  expect(useViewStore.getState().selectionStyle).toBeNull();

  fireEvent.change(screen.getByLabelText('Selected atoms'), { target: { value: 'vdw' } });
  expect(useViewStore.getState().selectionStyle).toBe('vdw');

  fireEvent.change(screen.getByLabelText('Selected atoms'), { target: { value: '' } });
  expect(useViewStore.getState().selectionStyle).toBeNull();
});

test('choosing a label content switches the label layer on', () => {
  render(<DisplayPanel />);
  expect(useViewStore.getState().showLabels).toBe(false);

  fireEvent.change(screen.getByLabelText('Atoms'), { target: { value: 'partial_charge' } });
  const view = useViewStore.getState();
  expect(view.atomLabels).toBe('partial_charge');
  // picking a content is how a user asks for labels; requiring a second click would be a trap
  expect(view.showLabels).toBe(true);
});

test('label style controls are per-axis and independent', () => {
  render(<DisplayPanel />);
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: '1.2' } });
  fireEvent.change(screen.getByLabelText('Label shift y'), { target: { value: '0.5' } });
  fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#ff0000' } });

  const view = useViewStore.getState();
  expect(view.labelSize).toBe(1.2);
  expect(view.labelShift).toEqual([0, 0.5, 0]);
  expect(view.labelColor).toBe('#ff0000');
});

test('the panel says when a setting has nothing to act on', () => {
  render(<DisplayPanel />);
  expect(screen.getByText(/carries no vector field/)).toBeInTheDocument();
  expect(screen.getByText('This structure has no unit cell.')).toBeInTheDocument();
});
