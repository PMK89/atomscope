import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('./Viewport', () => ({
  Viewport: () => <div data-testid="viewport" />,
}));
vi.mock('./ProjectPanel', () => ({ ProjectPanel: () => <div>Project</div> }));
vi.mock('./CalculationPanel', () => ({ CalculationPanel: () => <div>Calculation</div> }));

import { App } from './App';
import { useStructureStore } from '../state/structureStore';

test('renders the shell with a viewport and demo molecule', () => {
  render(<App />);
  expect(screen.getByTestId('viewport')).toBeInTheDocument();
  expect(screen.getAllByText('H2O').length).toBeGreaterThan(0);
  expect(screen.getByText('3 atoms, 2 bonds')).toBeInTheDocument();
});

test('view menu switches representation and edit menu reflects history', () => {
  render(<App />);
  fireEvent.click(screen.getByText('View'));
  fireEvent.click(screen.getByText('Stick'));
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByText('Undo').closest('button')).toBeDisabled();
  const st = useStructureStore.getState();
  st.commit('rename', { ...st.doc, name: 'renamed' });
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByText('Undo rename')).toBeInTheDocument();
});

test('toolbar switches tools and shows the tool settings panel', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
  expect(screen.getByLabelText('Element symbol')).toHaveValue('C');
  expect(screen.getByLabelText('Bond order')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
  expect(screen.queryByLabelText('Element symbol')).not.toBeInTheDocument();
});

test('edit menu selects all atoms and the properties tab shows the selection', () => {
  render(<App />);
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.click(screen.getByText('Select all'));
  expect(screen.getByText('3 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));
  expect(screen.getByText(/3 atoms selected/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.click(screen.getByText('Invert selection'));
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});

test('cartesian editor applies coordinates as an undoable edit', () => {
  render(<App />);
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cartesian editor…' }));
  const ta = screen.getByLabelText('Coordinates');
  fireEvent.change(ta, { target: { value: 'O 0 0 0\nH 0 0.8 -0.5\nH 0 -0.8 -0.5' } });
  fireEvent.click(screen.getByText('Apply'));
  expect(useStructureStore.getState().undoLabel()).toBe('Edit coordinates');
  expect(useStructureStore.getState().doc.atoms[1]!.position[1]).toBe(0.8);
});
