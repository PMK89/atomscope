/**
 * Thermochemistry from the modes the Spectra panel already has (`analysis/thermo.py`).
 *
 * It lives with the vibrations rather than in a panel of its own because it is a function of
 * them: frequencies in, state functions out. What the user has to supply is what ASE cannot work
 * out -- the model, the temperature range, and for a gas-phase molecule its rotational symmetry
 * number and spin.
 *
 * Three models: **ideal gas** for a molecule in the gas phase (an enthalpy and a Gibbs energy,
 * and the only one that depends on pressure), **harmonic** for an adsorbate held on a surface,
 * and **hindered** for one that can hop and rotate over barriers. ASE's `CrystalThermo` is not
 * offered: it needs a phonon density of states, which nothing here produces.
 */
import { useState } from 'react';

import { api, type HinderedParameters, type ThermoModel, type ThermoTable } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import type { StructureDoc } from '../model/structure';
import type { ApiVibrationalMode } from '../model/vibration';
import { LineChart, type ChartSeries } from './charts/LineChart';

const MODELS: { value: ThermoModel; label: string }[] = [
  { value: 'harmonic', label: 'Harmonic (adsorbate)' },
  { value: 'ideal-gas', label: 'Ideal gas (molecule)' },
  { value: 'hindered', label: 'Hindered translator/rotor' },
];

const FREE_ENERGY_COLOR = '#2f6fdb';
const TS_COLOR = '#e07a3c';
/** Standard pressure, and ASE's own reference pressure. */
const STANDARD_PRESSURE_PA = 1.0e5;

const DEFAULT_HINDERED: HinderedParameters = {
  trans_barrier_energy_ev: 0.05,
  rot_barrier_energy_ev: 0.02,
  site_density_cm2: 1.5e15,
  rotational_minima: 6,
  symmetry_number: 1,
  mass_amu: null,
  inertia_amu_a2: null,
};

/** The temperatures the table is asked for: `from`, then every `step` up to `to`. */
export function temperatureRange(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !(from > 0) || to < from) return from > 0 ? [from] : [];
  const out: number[] = [];
  // a count rather than repeated addition, so 0.1-sized steps do not drift
  const n = Math.floor((to - from) / step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(Number((from + i * step).toFixed(4)));
  return out;
}

export function ThermoSection({
  modes,
  structure,
  onError,
}: {
  modes: ApiVibrationalMode[];
  structure: StructureDoc;
  onError: (m: string) => void;
}): JSX.Element {
  const [model, setModel] = useState<ThermoModel>('harmonic');
  const [from, setFrom] = useState(298.15);
  const [to, setTo] = useState(1000);
  const [step, setStep] = useState(100);
  const [pressure, setPressure] = useState(STANDARD_PRESSURE_PA);
  const [symmetryNumber, setSymmetryNumber] = useState(1);
  const [spin, setSpin] = useState(0);
  const [potential, setPotential] = useState(0);
  const [ignoreImaginary, setIgnoreImaginary] = useState(false);
  const [hindered, setHindered] = useState<HinderedParameters>(DEFAULT_HINDERED);
  const [table, setTable] = useState<ThermoTable | null>(null);
  const [busy, setBusy] = useState(false);

  const temperatures = temperatureRange(from, to, step);
  const imaginary = modes.filter((m) => m.frequency < 0).length;

  const compute = async (): Promise<void> => {
    setBusy(true);
    try {
      setTable(
        await api.analysis.thermo({
          model,
          frequencies_cm: modes.map((m) => m.frequency),
          temperatures_k: temperatures,
          // the harmonic model needs no structure, and posting one would only make the request
          // bigger; the other two need the mass and the moments of inertia
          structure: model === 'harmonic' ? null : toApiStructure(structure),
          potential_energy_ev: potential,
          pressure_pa: pressure,
          symmetry_number: symmetryNumber,
          spin,
          hindered: model === 'hindered' ? hindered : null,
          ignore_imaginary: ignoreImaginary,
        }),
      );
    } catch (e) {
      setTable(null);
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const series: ChartSeries[] =
    table === null
      ? []
      : [
          {
            id: 'free',
            label: table.free_energy_kind === 'gibbs' ? 'G' : 'F',
            x: table.points.map((p) => p.temperature_k),
            y: table.points.map((p) => p.free_energy_ev),
            color: FREE_ENERGY_COLOR,
          },
          {
            id: 'ts',
            label: 'T·S',
            x: table.points.map((p) => p.temperature_k),
            y: table.points.map((p) => p.ts_ev),
            color: TS_COLOR,
            dashed: true,
          },
        ];

  const hinderedField = (
    key: 'trans_barrier_energy_ev' | 'rot_barrier_energy_ev' | 'site_density_cm2',
    label: string,
  ): JSX.Element => (
    <div className="form-row">
      <label htmlFor={`thermo-${key}`}>{label}</label>
      <input
        id={`thermo-${key}`}
        type="number"
        step="any"
        min="0"
        value={hindered[key] ?? 0}
        onChange={(e) => setHindered({ ...hindered, [key]: Number(e.target.value) })}
      />
    </div>
  );

  return (
    <div className="thermo-section">
      <h4>Thermochemistry</h4>
      <div className="form-row">
        <label htmlFor="thermo-model">Model</label>
        <select
          id="thermo-model"
          value={model}
          onChange={(e) => setModel(e.target.value as ThermoModel)}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="thermo-from">T from / K</label>
        <input
          id="thermo-from"
          type="number"
          step="any"
          min="0.01"
          value={from}
          onChange={(e) => setFrom(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="thermo-to">T to / K</label>
        <input
          id="thermo-to"
          type="number"
          step="any"
          min="0.01"
          value={to}
          onChange={(e) => setTo(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="thermo-step">T step / K</label>
        <input
          id="thermo-step"
          type="number"
          step="any"
          min="0.01"
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="thermo-epot">E potential / eV</label>
        <input
          id="thermo-epot"
          type="number"
          step="any"
          value={potential}
          onChange={(e) => setPotential(Number(e.target.value))}
        />
      </div>
      {model === 'ideal-gas' && (
        <>
          <div className="form-row">
            <label htmlFor="thermo-pressure">Pressure / Pa</label>
            <input
              id="thermo-pressure"
              type="number"
              step="any"
              min="0.01"
              value={pressure}
              onChange={(e) => setPressure(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label htmlFor="thermo-sigma">Symmetry number</label>
            <input
              id="thermo-sigma"
              type="number"
              min="1"
              step="1"
              value={symmetryNumber}
              onChange={(e) => setSymmetryNumber(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label htmlFor="thermo-spin">Spin S</label>
            <input
              id="thermo-spin"
              type="number"
              min="0"
              step="0.5"
              value={spin}
              onChange={(e) => setSpin(Number(e.target.value))}
            />
          </div>
          <p className="muted">
            σ is the rotational symmetry number and cannot be guessed from a geometry: 1 for CO, 2
            for H₂O and N₂, 3 for NH₃, 12 for CH₄ and benzene. Leaving it at 1 overestimates the
            entropy.
          </p>
        </>
      )}
      {model === 'hindered' && (
        <>
          {hinderedField('trans_barrier_energy_ev', 'Diffusion barrier / eV')}
          {hinderedField('rot_barrier_energy_ev', 'Rotation barrier / eV')}
          {hinderedField('site_density_cm2', 'Site density / cm⁻²')}
          <div className="form-row">
            <label htmlFor="thermo-minima">Rotational minima</label>
            <input
              id="thermo-minima"
              type="number"
              min="1"
              step="1"
              value={hindered.rotational_minima}
              onChange={(e) =>
                setHindered({ ...hindered, rotational_minima: Number(e.target.value) })
              }
            />
          </div>
          <p className="muted">
            The mass and the moment of inertia are taken from the structure on screen, which for
            this model has to be the adsorbate on its own rather than the slab.
          </p>
        </>
      )}
      {imaginary > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={ignoreImaginary}
            onChange={(e) => setIgnoreImaginary(e.target.checked)}
          />
          Ignore the {imaginary} imaginary {imaginary === 1 ? 'mode' : 'modes'}
        </label>
      )}
      <div className="button-row">
        <button onClick={() => void compute()} disabled={busy || modes.length === 0}>
          {busy ? 'Computing…' : 'Compute thermochemistry'}
        </button>
        <span className="muted">
          {temperatures.length} {temperatures.length === 1 ? 'temperature' : 'temperatures'}
        </span>
      </div>
      {table && (
        <>
          <p className="muted" role="status">
            {table.model} · {table.n_modes} modes · ZPE {table.zpe_ev.toFixed(4)} eV
            {table.n_imaginary ? ` · ${table.n_imaginary} imaginary dropped` : ''}
            {table.geometry ? ` · ${table.geometry}` : ''}
          </p>
          <div className="chart-box">
            <LineChart
              series={series}
              xLabel="T / K"
              yLabel="energy / eV"
              settingsId="thermo"
              zeroLine
            />
          </div>
          <table className="orbital-table" aria-label="thermochemistry">
            <thead>
              <tr>
                <th scope="col">T / K</th>
                <th scope="col">{table.model === 'ideal-gas' ? 'H / eV' : 'U / eV'}</th>
                <th scope="col">S / meV K⁻¹</th>
                <th scope="col">T·S / eV</th>
                <th scope="col">{table.free_energy_kind === 'gibbs' ? 'G / eV' : 'F / eV'}</th>
              </tr>
            </thead>
            <tbody>
              {table.points.map((p) => (
                <tr key={p.temperature_k}>
                  <td>{p.temperature_k}</td>
                  <td>{(p.enthalpy_ev ?? p.internal_energy_ev ?? 0).toFixed(4)}</td>
                  <td>{(p.entropy_ev_per_k * 1000).toFixed(4)}</td>
                  <td>{p.ts_ev.toFixed(4)}</td>
                  <td>{p.free_energy_ev.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
