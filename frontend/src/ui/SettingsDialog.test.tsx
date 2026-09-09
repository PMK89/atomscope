import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { useToolStore } from '../editor/toolStore';
import { useViewStore } from '../state/viewStore';
import { SettingsDialog } from './SettingsDialog';

beforeEach(() => {
  vi.restoreAllMocks();
  useViewStore.setState({ quality: 'auto', fog: 'none' });
  useToolStore.getState().setSettingsDialogOpen(true);
});

test('the rendering settings go to the view store, which is what persists them', async () => {
  vi.spyOn(api.backends, 'list').mockResolvedValue([]);
  render(<SettingsDialog />);

  fireEvent.change(screen.getByLabelText('Quality'), { target: { value: 'high' } });
  fireEvent.change(screen.getByLabelText('Depth cueing'), { target: { value: 'mid' } });
  fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'black' } });

  expect(useViewStore.getState().quality).toBe('high');
  // Avogadro names four bands of its 0-9 fogLevel; the setting carries the name
  expect(useViewStore.getState().fog).toBe('mid');
  expect(useViewStore.getState().background).toBe('black');
  await waitFor(() => expect(api.backends.list).toHaveBeenCalled());
});

test('the backends are listed with whether they are installed', async () => {
  vi.spyOn(api.backends, 'list').mockResolvedValue([
    {
      id: 'cppaw',
      name: 'CP-PAW',
      capabilities: {},
      executables: { available: false, messages: ['paw_fast.x not found'] },
    },
  ] as never);
  render(<SettingsDialog />);

  expect(await screen.findByText(/CP-PAW/)).toHaveTextContent('not available');
  expect(screen.getByText(/paw_fast.x not found/)).toBeTruthy();
});

test('a backend listing that fails is reported, not swallowed', async () => {
  vi.spyOn(api.backends, 'list').mockRejectedValue(new Error('offline'));
  render(<SettingsDialog />);
  expect(await screen.findByText(/Could not read the backends: offline/)).toBeTruthy();
});

test('Escape closes the dialog', async () => {
  vi.spyOn(api.backends, 'list').mockResolvedValue([]);
  render(<SettingsDialog />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(useToolStore.getState().settingsDialogOpen).toBe(false);
});
