import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { ExportDialog } from './ExportDialog';

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
    name: 'pdb',
    extensions: ['pdb', 'ent'],
    description: 'Protein Data Bank',
    can_read: true,
    can_write: true,
    library: 'ase',
  },
  {
    name: 'cml',
    extensions: ['cml'],
    description: 'Chemical Markup Language',
    can_read: true,
    can_write: true,
    library: 'openbabel',
  },
  {
    name: 'gaussian-out',
    extensions: ['log'],
    description: 'Gaussian output',
    can_read: true,
    can_write: false,
    library: 'ase',
  },
];

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(api.io, 'formats').mockResolvedValue(FORMATS as never);
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'water', atoms: [makeAtom('O', [0, 0, 0])] } as never));
});

const show = (): { onClose: ReturnType<typeof vi.fn> } => {
  const onClose = vi.fn();
  render(<ExportDialog open onClose={onClose} onError={(m) => void errors.push(m)} />);
  return { onClose };
};

test('a read-only format is not offered, and the default is CML', async () => {
  show();
  await screen.findByRole('option', { name: /Chemical Markup/ });
  expect(screen.queryByRole('option', { name: /Gaussian output/ })).toBeNull();
  expect(screen.getByLabelText('Format')).toHaveValue('cml');
});

test('the extension names the format and the format renames the file', async () => {
  show();
  await screen.findByRole('option', { name: /Chemical Markup/ });
  const path = screen.getByLabelText('Path on this machine');

  // typing an extension picks the format, and does not rewrite what is being typed
  fireEvent.change(path, { target: { value: '/tmp/water.ent' } });
  expect(screen.getByLabelText('Format')).toHaveValue('pdb');
  expect(path).toHaveValue('/tmp/water.ent');

  // choosing a format renames the file to the extension that format writes
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'xyz' } });
  expect(path).toHaveValue('/tmp/water.xyz');

  // an extension nothing writes leaves the format alone
  fireEvent.change(path, { target: { value: '/tmp/water.zzz' } });
  expect(screen.getByLabelText('Format')).toHaveValue('xyz');
});

test('a file that is already there is only written over on a second click', async () => {
  const write = vi
    .spyOn(api.io, 'export')
    .mockRejectedValueOnce(new ApiError(409, '/tmp/water.xyz exists'))
    .mockResolvedValueOnce({ path: '/tmp/water.xyz' } as never);
  const { onClose } = show();
  await screen.findByRole('option', { name: /Chemical Markup/ });
  fireEvent.change(screen.getByLabelText('Path on this machine'), {
    target: { value: '/tmp/water.xyz' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('/tmp/water.xyz exists already');
  expect(onClose).not.toHaveBeenCalled();
  expect(errors).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(write.mock.calls.map((c) => (c[0] as { overwrite: boolean }).overwrite)).toEqual([
    false,
    true,
  ]);
});

test('anything else is reported and the dialog stays open', async () => {
  vi.spyOn(api.io, 'export').mockRejectedValue(new ApiError(400, 'ASE could not write it'));
  const { onClose } = show();
  await screen.findByRole('option', { name: /Chemical Markup/ });
  fireEvent.change(screen.getByLabelText('Path on this machine'), {
    target: { value: '/tmp/water.xyz' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(errors).toEqual(['Export failed: ASE could not write it']));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Overwrite' })).toBeNull();
});
