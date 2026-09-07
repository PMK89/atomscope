import type { ScalarSeries } from '../api/client';

/**
 * Which of a run's scalar series belong on which chart.
 *
 * A CP-PAW run reports its progress on two different x axes: the total, conserved and fictitious
 * kinetic energies against the iteration number in eV, and the ionic temperature and the two
 * thermostat frictions against simulated time. Drawn together the time series land at the far left
 * of an eV axis and vanish, so they get their own charts -- the course plots them separately too
 * (Figs 5.1, 5.2, 5.3).
 *
 * Classification is by axis and unit rather than by name, so a series added to a backend later
 * lands on the right chart, or on none, instead of quietly on the wrong one. It is deliberately
 * "the energies that are not against time" rather than "the ones against steps": the force-field
 * backend indexes a conformer search by `conformer`, and a whitelist of x labels would have
 * dropped its only series and left its Convergence tab empty.
 */
export interface RunSeriesCharts {
  /** iteration-indexed, in eV: the convergence and total-energy charts */
  convergence: ScalarSeries[];
  /** ionic temperature against time, if the run had atom dynamics */
  temperature: ScalarSeries | undefined;
  /** the wave and atom thermostat frictions against time, dimensionless */
  friction: ScalarSeries[];
}

export function partitionRunSeries(series: readonly ScalarSeries[]): RunSeriesCharts {
  return {
    convergence: series.filter((s) => s.y_unit === 'eV' && s.x_label !== 'time'),
    temperature: series.find((s) => s.name === 'temperature'),
    friction: series.filter((s) => s.name.startsWith('friction_')),
  };
}
