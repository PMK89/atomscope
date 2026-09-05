import { fireEvent, render, screen, within } from '@testing-library/react';
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
  // the Display panel offers the same styles, so pick the menu item specifically
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Stick' }));
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

test('the select menu selects all atoms and the properties tab shows the selection', () => {
  render(<App />);
  fireEvent.click(within(screen.getByRole('menubar')).getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByText('Select all'));
  expect(screen.getByText('3 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));
  expect(screen.getByText(/3 atoms selected/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('menubar')).getByRole('button', { name: 'Select' }));
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

test('dock tabs are associated with their panels', () => {
  render(<App />);
  const tab = screen.getByRole('tab', { name: 'Surfaces' });
  const panelId = tab.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  const panel = document.getElementById(panelId!);
  expect(panel).toHaveAttribute('role', 'tabpanel');
  expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  // every tab stays reachable with Tab; selection is reflected in aria-selected
  expect(tab).not.toHaveAttribute('tabindex');
  expect(tab).toHaveAttribute('aria-selected', 'false');
  fireEvent.click(tab);
  expect(tab).toHaveAttribute('aria-selected', 'true');
});

test('the cartesian editor is a modal dialog that traps and restores focus', () => {
  render(<App />);
  const editMenu = screen.getByRole('button', { name: 'Edit' });
  fireEvent.click(editMenu);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cartesian editor…' }));
  const dialog = screen.getByRole('dialog', { name: 'Cartesian editor' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  const textarea = screen.getByLabelText('Coordinates');
  expect(document.activeElement).toBe(textarea);

  // Tab from the last control wraps back to the first, Shift+Tab the other way. The first is
  // the units box; the textarea is what the dialog opens focused on, which is not the same thing.
  const units = screen.getByLabelText('Units');
  const close = screen.getByRole('button', { name: 'Close' });
  close.focus();
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(document.activeElement).toBe(units);
  fireEvent.keyDown(units, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(close);

  fireEvent.keyDown(close, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  // focus returned to the menu the dialog was opened from
  expect(document.activeElement).toBe(editMenu);
});

test('the help menu explains the shortcuts and where the guides are', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Help' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }));

  const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByText('Cut / Copy / Paste')).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Help' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /User guide/ }));
  expect(screen.getByText(/docs\/user-guide.md/)).toBeInTheDocument();
});

test('the dock remembers which tab was open in this browser', () => {
  const { unmount } = render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));
  expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
  unmount();

  render(<App />);
  expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Calculation' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  window.localStorage.clear();
});
