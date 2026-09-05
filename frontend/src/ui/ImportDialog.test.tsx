import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { makeAtom } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { ImportDialog, acceptFilter } from './ImportDialog';

const FORMATS = [
  {
    name: 'xyz',
    extensions: ['xyz'],
    description: 'XYZ Cartesian coordinates',
    can_read: true,
    can_write: true,
    library: 'ase',
  },
  {
    name: 'gaussian-out',
    extensions: ['log', 'g16'],
    description: 'Gaussian output',
    can_read: true,
    can_write: false,
    library: 'ase',
  },
  {
    name: 'smi',
    extensions: ['smi'],
    description: 'SMILES',
    can_read: false,
    can_write: true,
    library: 'rdkit',
  },
];

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.spyOn(api.io, 'formats').mockResolvedValue(FORMATS as never);
});

test('the picker offers every extension a reader claims, and nothing write-only', () => {
  expect(acceptFilter(FORMATS as never)).toBe('.g16,.log,.xyz');
});

test('a path is opened with the chosen format override', async () => {
  const importPath = vi
    .spyOn(api.io, 'importPath')
    .mockResolvedValue({ name: 'run', atoms: [makeAtom('C', [0, 0, 0])] } as never);
  const onClose = vi.fn();
  render(<ImportDialog open onClose={onClose} onError={(m) => void errors.push(m)} />);

  await screen.findByRole('option', { name: /Gaussian output/ });
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'gaussian-out' } });
  fireEvent.change(screen.getByLabelText('Path on this machine'), {
    target: { value: '/tmp/run.txt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open path' }));

  await waitFor(() =>
    expect(importPath).toHaveBeenCalledWith({ path: '/tmp/run.txt', format: 'gaussian-out' }),
  );
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('run'));
  expect(onClose).toHaveBeenCalled();
});

test('an unreadable file is reported and the dialog stays open', async () => {
  vi.spyOn(api.io, 'importPath').mockRejectedValue(new Error('cannot determine format'));
  const onClose = vi.fn();
  render(<ImportDialog open onClose={onClose} onError={(m) => void errors.push(m)} />);

  fireEvent.change(screen.getByLabelText('Path on this machine'), { target: { value: '/tmp/x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open path' }));

  await waitFor(() => expect(errors[0]).toMatch(/cannot determine format/));
  expect(onClose).not.toHaveBeenCalled();
});

test('choosing a file uploads it with the override', async () => {
  const upload = vi
    .spyOn(api.io, 'importUpload')
    .mockResolvedValue({ name: 'up', atoms: [makeAtom('C', [0, 0, 0])] } as never);
  render(<ImportDialog open onClose={() => {}} onError={(m) => void errors.push(m)} />);
  await screen.findByRole('option', { name: /Gaussian output/ });
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'xyz' } });

  const input = screen.getByTestId('import-file-input');
  const file = new File(['1\n\nC 0 0 0\n'], 'weird.dat', { type: 'text/plain' });
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(upload).toHaveBeenCalledWith(file, 'xyz'));
});
