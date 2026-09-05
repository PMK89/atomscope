import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { useProjectStore } from '../state/projectStore';
import { ESP_LIMIT, estimatePoints, SurfaceGenerator } from './SurfaceGenerator';

const INFO = {
  source: '/data/co.fchk',
  format: 'fchk',
  n_electrons: 14,
  n_basis: 30,
  homo_index: 6,
  structure: {
    id: 's1',
    atoms: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'O', position: [0, 0, 1.13] },
    ],
  },
  orbitals: [
    { index: 6, label: 'HOMO', energy: -0.5, occupation: 2, spin: 'none' },
    { index: 7, label: 'LUMO', energy: 0.1, occupation: 0, spin: 'none' },
  ],
};

beforeEach(() => {
  // the panel refreshes the project after loading a wavefunction; there is no backend here
  useProjectStore.setState({
    info: { name: 'p', path: '/p' } as never,
    refresh: async () => undefined,
  });
  vi.restoreAllMocks();
});

test('estimatePoints matches the box the backend builds', () => {
  // span 0 + 2*3.5 padding = 7 A in every direction: ceil(7/0.5) + 1 = 15 per axis
  expect(estimatePoints([[0, 0, 0]], 3.5, 0.5)).toBe(15 ** 3);
  expect(estimatePoints([], 3.5, 0.5)).toBe(0);
});

test('loads a wavefunction and requests the selected orbital', async () => {
  vi.spyOn(api.wavefunction, 'load').mockResolvedValue(INFO as never);
  // the evaluation runs beside the request: a token comes back, the grid arrives when it is done
  const surface = vi
    .spyOn(api.wavefunction, 'surface')
    .mockResolvedValue({ id: 't1', status: 'running', progress: 0 } as never);
  vi.spyOn(api.wavefunction, 'surfaceStatus').mockResolvedValue({
    id: 't1',
    status: 'done',
    progress: 1,
    grid: { id: 'g1', kind: 'orbital' },
  } as never);
  const onCreated = vi.fn();

  render(<SurfaceGenerator onError={() => {}} onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText('Wavefunction'), { target: { value: '/data/co.fchk' } });
  fireEvent.click(screen.getByText('Load'));

  await screen.findByTestId('wf-summary');
  expect(screen.getByTestId('wf-summary').textContent).toContain('14 electrons');
  // the HOMO is preselected
  expect((screen.getByLabelText('Orbital') as HTMLSelectElement).value).toBe('6');
  fireEvent.change(screen.getByLabelText('Orbital'), { target: { value: '7' } });
  fireEvent.click(screen.getByText('Calculate'));

  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(surface).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/data/co.fchk', kind: 'orbital', orbital_index: 7 }),
  );
});

test('refuses an electrostatic potential grid the backend would reject', async () => {
  vi.spyOn(api.wavefunction, 'load').mockResolvedValue(INFO as never);
  render(<SurfaceGenerator onError={() => {}} onCreated={() => {}} />);
  fireEvent.change(screen.getByLabelText('Wavefunction'), { target: { value: '/data/co.fchk' } });
  fireEvent.click(screen.getByText('Load'));
  await screen.findByTestId('wf-summary');

  fireEvent.change(screen.getByLabelText('Surface type'), {
    target: { value: 'electrostatic_potential' },
  });
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '0.1' } });
  expect(
    estimatePoints(
      INFO.structure.atoms.map((a) => a.position as never),
      3.5,
      0.1,
    ),
  ).toBeGreaterThan(ESP_LIMIT);
  expect(screen.getByTestId('wf-points').textContent).toContain('too many');
  expect(screen.getByText('Calculate')).toBeDisabled();
});

test('a running evaluation shows how far it has got and can be stopped', async () => {
  vi.spyOn(api.wavefunction, 'load').mockResolvedValue(INFO as never);
  vi.spyOn(api.wavefunction, 'surface').mockResolvedValue({
    id: 't2',
    status: 'running',
    progress: 0,
  } as never);
  const statuses = [
    { id: 't2', status: 'running', progress: 0.42 },
    { id: 't2', status: 'cancelled', progress: 0.42 },
  ];
  vi.spyOn(api.wavefunction, 'surfaceStatus').mockImplementation(
    () => Promise.resolve((statuses.shift() ?? statuses[0]) as never) as never,
  );
  const cancel = vi
    .spyOn(api.wavefunction, 'cancelSurface')
    .mockResolvedValue({ id: 't2', status: 'cancelled', progress: 0.42 } as never);
  const onCreated = vi.fn();

  render(<SurfaceGenerator onError={() => {}} onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText('Wavefunction'), { target: { value: '/data/co.fchk' } });
  fireEvent.click(screen.getByText('Load'));
  await screen.findByTestId('wf-summary');
  fireEvent.click(screen.getByText('Calculate'));

  const stop = await screen.findByRole('button', { name: 'Cancel' });
  expect(await screen.findByText('Calculating… 42%')).toBeInTheDocument();
  fireEvent.click(stop);
  expect(cancel).toHaveBeenCalledWith('t2');

  // a cancelled evaluation is not an error and produces no surface
  await waitFor(() => expect(screen.getByText('Calculate')).toBeEnabled());
  expect(onCreated).not.toHaveBeenCalled();
});

test('a failed evaluation is reported once, from the task rather than the request', async () => {
  vi.spyOn(api.wavefunction, 'load').mockResolvedValue(INFO as never);
  vi.spyOn(api.wavefunction, 'surface').mockResolvedValue({
    id: 't3',
    status: 'running',
    progress: 0,
  } as never);
  vi.spyOn(api.wavefunction, 'surfaceStatus').mockResolvedValue({
    id: 't3',
    status: 'failed',
    progress: 0.1,
    error: 'the basis went missing',
  } as never);
  const errors: string[] = [];

  render(<SurfaceGenerator onError={(m) => void errors.push(m)} onCreated={() => {}} />);
  fireEvent.change(screen.getByLabelText('Wavefunction'), { target: { value: '/data/co.fchk' } });
  fireEvent.click(screen.getByText('Load'));
  await screen.findByTestId('wf-summary');
  fireEvent.click(screen.getByText('Calculate'));

  await waitFor(() => expect(errors).toEqual(['the basis went missing']));
  expect(screen.getByText('Calculate')).toBeEnabled();
});
