import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      // a periodic point carries its own cell volume, which is what an EOS is a function of
      volume_a3: e === null ? null : 40 + 2 * i,
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

/**
 * The fitted curves (Figs 6.6, 6.7). The fit itself is the server's -- checked against the
 * course's own `paw_murnaghan.x` output in `tests/analysis/test_eos.py` -- so these check that
 * the panel asks for the right one, draws it on the right axes, and says what it found.
 */
const cubicFit = {
  kind: 'cubic',
  curve: { x: [7.8, 10, 12.2], y: [-471.0, -471.06, -471.04] },
  residuals_ev: [0.001, -0.002, 0.001],
  rms_ev: 0.0014,
  murnaghan: null,
  cubic: { coefficients: [1, 2, 3, 4], x_min: 10.4, y_min: -471.061, extrapolated: false },
};

const murnaghanFit = {
  kind: 'murnaghan',
  curve: { x: [39.6, 42, 44.4], y: [-471.0, -471.06, -471.04] },
  residuals_ev: [0.001, -0.002, 0.001],
  rms_ev: 0.0014,
  cubic: null,
  murnaghan: {
    e0_ev: -471.0612,
    v0_a3: 42.0,
    b0_gpa: 91.84,
    bp: 5.3237,
    lattice_constant_a: null,
    extrapolated: false,
  },
};

const withSweep = (c = curve([-471.0, -471.05, -471.06], 10)): void => {
  vi.spyOn(api.sweeps, 'list').mockResolvedValue([summary] as never);
  vi.spyOn(api.sweeps, 'get').mockResolvedValue(c as never);
};

test('no fit is asked for until one is chosen', async () => {
  withSweep();
  const fit = vi.spyOn(api.sweeps, 'fit').mockResolvedValue(cubicFit as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  expect(await screen.findByRole('img', { name: 'Convergence' })).toBeInTheDocument();
  expect(fit).not.toHaveBeenCalled();
  // one curve on the energy chart, no fit over it
  expect(
    screen.getByRole('img', { name: 'Convergence' }).querySelectorAll('polyline'),
  ).toHaveLength(1);
});

test('the cubic is drawn on the sweep own axes, because that is what it fits (Fig. 6.6)', async () => {
  withSweep();
  const fit = vi.spyOn(api.sweeps, 'fit').mockResolvedValue(cubicFit as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await screen.findByRole('img', { name: 'Convergence' });

  fireEvent.change(screen.getByLabelText('Fitted curve'), { target: { value: 'cubic' } });
  await waitFor(() => expect(fit).toHaveBeenCalledWith('s1', 'cubic', undefined));

  const chart = screen.getByRole('img', { name: 'Convergence' });
  // the points and the fit, on one set of axes -- and no second chart, the cubic has no volume
  await waitFor(() => expect(chart.querySelectorAll('polyline')).toHaveLength(2));
  expect(screen.queryByRole('img', { name: 'Equation of state' })).toBeNull();
  // the fit is dashed so the measured points stay the solid line
  expect(chart.querySelector('polyline[stroke-dasharray]')).not.toBeNull();
  // and its minimum is stated in the sweep's own units rather than left to the eye
  await waitFor(() =>
    expect(screen.getByText(/Minimum at Lattice parameter/)).toHaveTextContent('10.400'),
  );
  expect(errors).toEqual([]);
});

test('the equation of state gets its own chart against volume (Fig. 6.7)', async () => {
  withSweep();
  const fit = vi.spyOn(api.sweeps, 'fit').mockResolvedValue(murnaghanFit as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await screen.findByRole('img', { name: 'Convergence' });

  fireEvent.change(screen.getByLabelText('Fitted curve'), { target: { value: 'murnaghan' } });
  await waitFor(() => expect(fit).toHaveBeenCalledWith('s1', 'murnaghan', undefined));

  const chart = await screen.findByRole('img', { name: 'Equation of state' });
  expect(chart.querySelectorAll('polyline')).toHaveLength(2);
  // against volume, not against the percentage the sweep varied
  expect(chart).toHaveTextContent('cell volume [Å³]');
  // the convergence chart keeps its single curve: the EOS does not belong on those axes
  expect(
    screen.getByRole('img', { name: 'Convergence' }).querySelectorAll('polyline'),
  ).toHaveLength(1);
  // the bulk modulus leads, because that is what the exercise asks for
  const readout = screen.getByText(/B₀ = /);
  expect(readout).toHaveTextContent('B₀ = 91.84 GPa');
  expect(readout).toHaveTextContent('B′ = 5.324');
  // the convergence answer stays the panel's only live region, so bare status locators still work
  expect(screen.getByRole('status')).toHaveTextContent(/Settled from/);
  expect(errors).toEqual([]);
});

test('a lattice constant is asked of the server, not computed in the browser', async () => {
  withSweep();
  const fit = vi.spyOn(api.sweeps, 'fit').mockResolvedValue({
    ...murnaghanFit,
    murnaghan: { ...murnaghanFit.murnaghan, lattice_constant_a: 5.4434 },
  } as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await screen.findByRole('img', { name: 'Convergence' });
  fireEvent.change(screen.getByLabelText('Fitted curve'), { target: { value: 'murnaghan' } });

  // the -vbl field only exists for this fit, because only this fit has a use for it
  const vbl = await screen.findByLabelText('Cell volume / a³');
  fireEvent.change(vbl, { target: { value: '0.25' } });
  await waitFor(() => expect(fit).toHaveBeenCalledWith('s1', 'murnaghan', 0.25));
  await waitFor(() => expect(screen.getByText(/B₀ = /)).toHaveTextContent('a₀ = 5.4434 Å'));
});

test('a nonsense -vbl is refused without asking the server', async () => {
  withSweep();
  const fit = vi.spyOn(api.sweeps, 'fit').mockResolvedValue(murnaghanFit as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await screen.findByRole('img', { name: 'Convergence' });
  fireEvent.change(screen.getByLabelText('Fitted curve'), { target: { value: 'murnaghan' } });
  await waitFor(() => expect(fit).toHaveBeenCalled());
  fit.mockClear();

  fireEvent.change(await screen.findByLabelText('Cell volume / a³'), { target: { value: '0' } });
  expect(await screen.findByText(/has to be a positive number/)).toBeVisible();
  expect(fit).not.toHaveBeenCalled();
});

test('an extrapolated equilibrium says the sweep did not bracket it', async () => {
  withSweep();
  vi.spyOn(api.sweeps, 'fit').mockResolvedValue({
    ...murnaghanFit,
    murnaghan: { ...murnaghanFit.murnaghan, v0_a3: 60, extrapolated: true },
  } as never);
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await screen.findByRole('img', { name: 'Convergence' });
  fireEvent.change(screen.getByLabelText('Fitted curve'), { target: { value: 'murnaghan' } });
  expect(await screen.findByText(/widen the sweep/)).toBeVisible();
});

test('a fit that cannot be made is reported in place, not as an application error', async () => {
  withSweep();
  vi.spyOn(api.sweeps, 'fit').mockRejectedValue(
    new Error('some finished points have no cell volume, so they are not periodic'),
  );
  render(<SweepPanel onError={(m) => void errors.push(m)} />);
  await screen.findByRole('img', { name: 'Convergence' });
  fireEvent.change(screen.getByLabelText('Fitted curve'), { target: { value: 'murnaghan' } });

  expect(await screen.findByText(/they are not periodic/)).toBeVisible();
  expect(screen.queryByRole('img', { name: 'Equation of state' })).toBeNull();
  // the banner is for things the user cannot act on; "not periodic" is an answer
  expect(errors).toEqual([]);
});
