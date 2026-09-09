import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { api, type ThermoTable } from '../api/client';
import { makeAtom, normalizeStructure } from '../model/structure';
import type { ApiVibrationalMode } from '../model/vibration';
import { ThermoSection, temperatureRange } from './ThermoSection';

const mode = (frequency: number): ApiVibrationalMode =>
  ({
    frequency,
    displacements: [[0, 0, 0.1]],
    reduced_mass: 1,
    kind: 'vibration',
    ir_intensity: null,
  }) as ApiVibrationalMode;

const table = (over: Partial<ThermoTable> = {}): ThermoTable =>
  ({
    model: 'harmonic',
    free_energy_kind: 'helmholtz',
    geometry: null,
    symmetry_number: null,
    spin: null,
    potential_energy_ev: 0,
    zpe_ev: 0.0187,
    n_modes: 3,
    n_imaginary: 0,
    points: [
      {
        temperature_k: 298.15,
        pressure_pa: null,
        internal_energy_ev: 0.03,
        enthalpy_ev: null,
        entropy_ev_per_k: 0.0001,
        free_energy_ev: 0.0002,
        ts_ev: 0.0298,
      },
      {
        temperature_k: 398.15,
        pressure_pa: null,
        internal_energy_ev: 0.04,
        enthalpy_ev: null,
        entropy_ev_per_k: 0.00012,
        free_energy_ev: -0.0076,
        ts_ev: 0.0478,
      },
    ],
    ...over,
  }) as ThermoTable;

const structure = normalizeStructure({
  name: 'water',
  charge: 0,
  atoms: [
    makeAtom('O', [0, 0, 0]),
    makeAtom('H', [0, 0.76, 0.59]),
    makeAtom('H', [0, -0.76, 0.59]),
  ],
});

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
});

const section = (modes = [mode(100), mode(200), mode(300)]): void => {
  render(
    <ThermoSection modes={modes} structure={structure} onError={(m) => void errors.push(m)} />,
  );
};

test('the temperature range starts at the first value and steps up to the last', () => {
  expect(temperatureRange(298.15, 500, 100)).toEqual([298.15, 398.15, 498.15]);
  // an exact end is included rather than lost to floating point
  expect(temperatureRange(100, 400, 100)).toEqual([100, 200, 300, 400]);
  expect(temperatureRange(300, 300, 100)).toEqual([300]);
  // nonsense gives one temperature rather than an empty request or an endless loop
  expect(temperatureRange(300, 100, 100)).toEqual([300]);
  expect(temperatureRange(300, 500, 0)).toEqual([300]);
});

test('the harmonic model posts the frequencies and no structure', async () => {
  const thermo = vi.spyOn(api.analysis, 'thermo').mockResolvedValue(table());
  section();
  await userEvent.click(screen.getByRole('button', { name: 'Compute thermochemistry' }));
  await waitFor(() => expect(thermo).toHaveBeenCalled());
  const body = thermo.mock.calls[0]![0] as Record<string, unknown>;
  expect(body['model']).toBe('harmonic');
  expect(body['frequencies_cm']).toEqual([100, 200, 300]);
  // a harmonic oscillator needs no mass and no moments of inertia
  expect(body['structure']).toBeNull();
  // the defaults: 298.15 K, then every 100 K up to 1000 -- eight points, the last 998.15
  expect(body['temperatures_k']).toEqual([
    298.15, 398.15, 498.15, 598.15, 698.15, 798.15, 898.15, 998.15,
  ]);
  expect(errors).toEqual([]);
});

test('the ideal-gas model sends the molecule, the pressure, sigma and the spin', async () => {
  const thermo = vi
    .spyOn(api.analysis, 'thermo')
    .mockResolvedValue(
      table({ model: 'ideal-gas', free_energy_kind: 'gibbs', geometry: 'nonlinear' }),
    );
  section();
  await userEvent.selectOptions(screen.getByLabelText('Model'), 'ideal-gas');
  await userEvent.clear(screen.getByLabelText('Symmetry number'));
  await userEvent.type(screen.getByLabelText('Symmetry number'), '2');
  await userEvent.click(screen.getByRole('button', { name: 'Compute thermochemistry' }));

  await waitFor(() => expect(thermo).toHaveBeenCalled());
  const body = thermo.mock.calls[0]![0] as Record<string, unknown>;
  expect(body['model']).toBe('ideal-gas');
  expect(body['symmetry_number']).toBe(2);
  expect(body['pressure_pa']).toBe(1e5);
  expect((body['structure'] as { atoms: unknown[] }).atoms).toHaveLength(3);
});

test('the pressure and sigma fields only exist for the ideal gas', async () => {
  section();
  expect(screen.queryByLabelText('Pressure / Pa')).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('Model'), 'ideal-gas');
  expect(screen.getByLabelText('Pressure / Pa')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Model'), 'hindered');
  expect(screen.queryByLabelText('Pressure / Pa')).toBeNull();
  // the hindered model asks for its barriers instead
  expect(screen.getByLabelText('Diffusion barrier / eV')).toBeVisible();
  expect(screen.getByLabelText('Rotational minima')).toBeVisible();
});

test('the hindered model sends its barriers and the structure', async () => {
  const thermo = vi.spyOn(api.analysis, 'thermo').mockResolvedValue(table({ model: 'hindered' }));
  section();
  await userEvent.selectOptions(screen.getByLabelText('Model'), 'hindered');
  await userEvent.click(screen.getByRole('button', { name: 'Compute thermochemistry' }));
  await waitFor(() => expect(thermo).toHaveBeenCalled());
  const body = thermo.mock.calls[0]![0] as Record<string, unknown>;
  const hindered = body['hindered'] as Record<string, number>;
  expect(hindered['rotational_minima']).toBe(6);
  expect(hindered['trans_barrier_energy_ev']).toBeGreaterThan(0);
  expect(body['structure']).not.toBeNull();
});

test('the table shows U for a harmonic model and H for a gas', async () => {
  vi.spyOn(api.analysis, 'thermo').mockResolvedValue(table());
  section();
  await userEvent.click(screen.getByRole('button', { name: 'Compute thermochemistry' }));
  const grid = await screen.findByRole('table', { name: 'thermochemistry' });
  expect(grid).toHaveTextContent('U / eV');
  expect(grid).toHaveTextContent('F / eV');
  expect(grid).not.toHaveTextContent('H / eV');
  // one row per temperature, plus the entropy in meV/K so it is readable
  expect(grid.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(grid).toHaveTextContent('0.1000'); // 0.0001 eV/K as meV/K
  expect(await screen.findByRole('status')).toHaveTextContent('ZPE 0.0187 eV');
});

test('an imaginary mode offers to be ignored, and only then', async () => {
  vi.spyOn(api.analysis, 'thermo').mockResolvedValue(table({ n_imaginary: 1 }));
  section([mode(100), mode(200)]);
  expect(screen.queryByLabelText(/Ignore the/)).toBeNull();

  render(
    <ThermoSection
      modes={[mode(-250), mode(100), mode(200)]}
      structure={structure}
      onError={(m) => void errors.push(m)}
    />,
  );
  const check = screen.getByLabelText('Ignore the 1 imaginary mode');
  expect(check).not.toBeChecked();
  await userEvent.click(check);
  expect(check).toBeChecked();
});

test('a refused request is reported and leaves no table behind', async () => {
  vi.spyOn(api.analysis, 'thermo').mockRejectedValue(new Error('1 imaginary mode(s) present'));
  section();
  await userEvent.click(screen.getByRole('button', { name: 'Compute thermochemistry' }));
  await waitFor(() => expect(errors).toEqual(['1 imaginary mode(s) present']));
  expect(screen.queryByRole('table', { name: 'thermochemistry' })).toBeNull();
});
