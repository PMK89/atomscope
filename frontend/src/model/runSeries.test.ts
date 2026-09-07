import { describe, expect, it } from 'vitest';

import type { ScalarSeries } from '../api/client';
import { partitionRunSeries } from './runSeries';

/** The series a CP-PAW run really reports, as stored by the course's own runs. */
function series(name: string, xLabel: string, yUnit: string): ScalarSeries {
  return {
    name,
    x_label: xLabel,
    x_unit: xLabel === 'time' ? 'ps' : '',
    y_label: name,
    y_unit: yUnit,
    x: [0, 1],
    y: [1, 2],
  } as ScalarSeries;
}

const RELAX = [
  series('energy', 'step', 'eV'),
  series('conserved_energy', 'step', 'eV'),
  series('ekin_psi', 'step', 'eV'),
  series('temperature', 'time', 'K'),
  series('friction_psi', 'time', ''),
  series('friction_atoms', 'time', ''),
];

const WAVE_ONLY = [
  series('energy', 'step', 'eV'),
  series('conserved_energy', 'step', 'eV'),
  series('ekin_psi', 'step', 'eV'),
  series('friction_psi', 'time', ''),
];

describe('partitionRunSeries', () => {
  it('keeps the time series off the eV convergence chart', () => {
    const { convergence, temperature, friction } = partitionRunSeries(RELAX);
    expect(convergence.map((s) => s.name)).toEqual(['energy', 'conserved_energy', 'ekin_psi']);
    expect(temperature?.name).toBe('temperature');
    expect(friction.map((s) => s.name)).toEqual(['friction_psi', 'friction_atoms']);
  });

  it('handles a run with no atom dynamics', () => {
    const { convergence, temperature, friction } = partitionRunSeries(WAVE_ONLY);
    expect(convergence).toHaveLength(3);
    expect(temperature).toBeUndefined();
    // the wave thermostat is on even without atom dynamics, the atom one is not
    expect(friction.map((s) => s.name)).toEqual(['friction_psi']);
  });

  it('keeps an energy indexed by something other than steps', () => {
    // the force-field backend indexes a conformer search by conformer, not by iteration; a
    // whitelist of x labels would leave its Convergence tab empty
    const conformers = [series('energy', 'conformer', 'eV')];
    expect(partitionRunSeries(conformers).convergence.map((s) => s.name)).toEqual(['energy']);
  });

  it('drops a series it does not know where to put', () => {
    const odd = [...WAVE_ONLY, series('pressure', 'time', 'GPa')];
    const { convergence, temperature, friction } = partitionRunSeries(odd);
    expect([...convergence, ...friction].map((s) => s.name)).not.toContain('pressure');
    expect(temperature).toBeUndefined();
  });
});
