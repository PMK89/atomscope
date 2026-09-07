import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { SweepPanel } from './SweepPanel';

const MH = 0.0272113838;

const summary = {
  sweep_id: 's1',
  label: 'Lattice parameter',
  unit: 'angstrom',
  key: null,
  points: 3,
  completed: 3,
};

const curve = (energies: (number | null)[], convergedFrom: number | null, counts = true) => ({
  result: {
    sweep_id: 's1',
    label: 'Lattice parameter',
    unit: 'angstrom',
    key: null,
    points: energies.map((e, i) => ({
      x: 8 + 2 * i,
      calculation_id: `c${i}`,
      status: e === null ? 'draft' : 'completed',
      energy_ev: e,
      properties:
        e === null
          ? {}
          : {
              energy: e,
              // the two counts the tutorial lists beside every energy, absent from a run
              // collected before the parser read them
              ...(counts
                ? {
                    plane_waves_wavefunction: 1000 + 100 * i,
                    plane_waves_density: 4000 + 400 * i,
                  }
                : {}),
            },
    })),
  },
  converged_from: convergedFrom,
  tolerance_ev: MH,
});

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
});

test('with no sweeps it says what a sweep is rather than showing an empty chart', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([]);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  expect(await screen.findByText(/several calculations that differ in one way/)).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Sweep' })).toBeNull();
});

test('a settled curve says where it settled, in the axis units', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([summary] as never);
  vi.spyOn(api.sweeps, 'get').mockResolvedValue(curve([-471.0, -471.05, -471.06], 10) as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Settled from/));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Settled from lattice parameter 10 angstrom onwards, within 1.00 mH.',
  );
  // the chart is drawn, with the converged point marked
  expect(document.querySelector('svg')).not.toBeNull();
  expect(errors).toEqual([]);
});

test('a curve that never settles says so, and names the axis it swept', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([summary] as never);
  vi.spyOn(api.sweeps, 'get').mockResolvedValue(curve([-471.0, -471.1, -471.2], null) as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Not settled/));
  expect(screen.getByRole('status')).toHaveTextContent('lattice parameter');
});

test('one point is not a curve, and unrun points are counted rather than hidden', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([{ ...summary, completed: 1 }] as never);
  vi.spyOn(api.sweeps, 'get').mockResolvedValue(curve([-471.0, null, null], null) as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  expect(await screen.findByText(/One point so far/)).toBeVisible();
  expect(screen.getByText(/2 points still to run/)).toBeVisible();
});

test('the tolerance is asked of the server, not applied in the browser', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([summary] as never);
  const get = vi
    .spyOn(api.sweeps, 'get')
    .mockResolvedValue(curve([-471.0, -471.05, -471.06], 10) as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await waitFor(() => expect(get).toHaveBeenCalledWith('s1', MH));
});

test('draws the basis-set size under the energy, as the tutorial does (Fig. 8.1)', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([summary] as never);
  vi.spyOn(api.sweeps, 'get').mockResolvedValue(curve([-471.0, -471.05, -471.06], 10) as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);

  expect(await screen.findByText('Basis-set size')).toBeVisible();
  // both counts the tutorial's convergence tables list beside every energy, in one panel
  const panel = screen.getByRole('img', { name: 'Basis-set size' });
  expect(panel.querySelectorAll('polyline')).toHaveLength(2);
  // and the energy is still its own panel above it
  expect(screen.getByRole('img', { name: 'Convergence' })).toBeInTheDocument();
  expect(errors).toEqual([]);
});

test('leaves the basis-set panel out when the counts were never collected', async () => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([summary] as never);
  vi.spyOn(api.sweeps, 'get').mockResolvedValue(
    curve([-471.0, -471.05, -471.06], 10, false) as never,
  );
  render(<SweepPanel onError={(m) => void errors.push(m)} />);

  expect(await screen.findByText('Convergence')).toBeVisible();
  expect(screen.queryByText('Basis-set size')).toBeNull();
});
