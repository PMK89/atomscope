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
  expect(screen.getByText('H2O')).toBeInTheDocument();
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
