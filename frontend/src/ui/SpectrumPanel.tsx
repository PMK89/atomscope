/**
 * Vibrations and spectra: compute or import normal modes, list them, plot IR/Raman (sticks plus a
 * broadened curve), overlay an imported experimental spectrum, and animate a clicked mode.
 *
 * This is a dock panel of its own rather than a section of AnalysisPanel because AnalysisPanel is
 * scoped to the selected *calculation* and returns early when there is none; vibrations and
 * spectra work on the posted structure and on imported files, with no calculation involved.
 *
 * No chemistry lives here: modes, intensities and broadened curves come from the backend, and the
 * frame sequence for an animation is built by `model/vibration.ts`.
 */
import { useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import {
  formatFrequency,
  maxDisplacement,
  nearestPeak,
  scaleToMatch,
  type LineShape,
  type SpectrumDoc,
} from '../model/vibration';
import { useSpectrumStore } from '../state/spectrumStore';
import { useStructureStore } from '../state/structureStore';
import { OtherSpectra } from './OtherSpectra';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { LineChart, type ChartSeries, type ChartStick } from './charts/LineChart';

const COMPUTED_COLOR = '#2f6fdb';
const OVERLAY_COLOR = '#e07a3c';
const STICK_COLOR = '#7a8699';
const FORCE_FIELDS = ['MMFF94', 'MMFF94s', 'UFF', 'GAFF', 'Ghemical'];

function axisLabel(axis: SpectrumDoc['x']): string {
  return axis.unit ? `${axis.label} [${axis.unit}]` : axis.label;
}

export function SpectrumPanel({ onError }: { onError: (m: string) => void }): JSX.Element {
  const s = useSpectrumStore();
  const doc = useStructureStore((st) => st.doc);
  const animating = useTrajectoryStore((st) => st.trajectory?.kind === 'vibration');
  const spectrumFileInput = useRef<HTMLInputElement>(null);
  const outputFileInput = useRef<HTMLInputElement>(null);

  const [forceField, setForceField] = useState('MMFF94');
  const [width, setWidth] = useState(30);
  const [shape, setShape] = useState<LineShape>('gaussian');
  const [transmittance, setTransmittance] = useState(false);
  const [raman, setRaman] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [reverseX, setReverseX] = useState(true);

  const fail = (e: unknown): void => onError((e as Error).message);

  const active = s.spectra.find((e) => e.id === s.activeSpectrumId)?.spectrum ?? null;
  const overlay = s.spectra.find((e) => e.id === s.overlayId)?.spectrum ?? null;

  const series: ChartSeries[] = useMemo(() => {
    const out: ChartSeries[] = [];
    if (active && active.x_values.length > 0) {
      out.push({
        id: 'computed',
        label: active.name,
        x: active.x_values,
        y: active.y_values,
        color: COMPUTED_COLOR,
      });
    }
    if (overlay && overlay !== active && overlay.x_values.length > 0) {
      // the imported y unit is rarely the computed one, so match the peak heights to compare shapes
      const y = active ? scaleToMatch(overlay.y_values, active.y_values) : overlay.y_values;
      out.push({
        id: 'experimental',
        label: `${overlay.name} (scaled)`,
        x: overlay.x_values,
        y,
        color: OVERLAY_COLOR,
        dashed: true,
      });
    }
    return out;
  }, [active, overlay]);

  const sticks: ChartStick[] = useMemo(() => {
    if (!active) return [];
    return active.peaks.map((p) => ({
      x: p.x,
      y: p.intensity,
      color: STICK_COLOR,
      active: p.source_index === s.selectedMode,
    }));
  }, [active, s.selectedMode]);

  const rebroaden = async (): Promise<void> => {
    if (!s.vibrations) return;
    try {
      const spectrum = await api.analysis.vibrationalSpectrum({
        vibrations: s.vibrations,
        width,
        shape,
        scale_factor: scaleFactor,
        transmittance,
        raman,
      });
      s.addSpectrum(spectrum, false);
    } catch (e) {
      fail(e);
    }
  };

  const compute = async (): Promise<void> => {
    try {
      await s.computeVibrations({ calculator: 'openbabel', force_field: forceField });
    } catch (e) {
      fail(e);
    }
  };

  const importSpectrum = async (file: File): Promise<void> => {
    try {
      s.addSpectrum(await api.io.importSpectrumUpload(file), true);
    } catch (e) {
      fail(e);
    }
  };

  const importOutput = async (file: File): Promise<void> => {
    try {
      const res = await api.io.importVibrationsUpload(file);
      if (res.structure) {
        useStructureStore.getState().load(normalizeStructure(res.structure));
      }
      s.setImported(res);
      if (!res.vibrations) {
        // an output with only shieldings or transitions is still a spectrum source
        const other =
          (res.shieldings?.length ?? 0) + (res.transitions?.length ?? 0) > 0
            ? ` (${res.shieldings?.length ?? 0} NMR shieldings, ${res.transitions?.length ?? 0} transitions below)`
            : '';
        onError(`${file.name} has no vibrational data${other}`);
        return;
      }
      s.setVibrations(res.vibrations, file.name);
      const spectrum = await api.analysis.vibrationalSpectrum({
        vibrations: res.vibrations,
        width,
        shape,
        scale_factor: scaleFactor,
        transmittance,
        raman,
      });
      s.addSpectrum(spectrum, false);
    } catch (e) {
      fail(e);
    }
  };

  const pickPeak = (x: number): void => {
    if (!active) return;
    const i = nearestPeak(active.peaks, x);
    const index = active.peaks[i]?.source_index;
    if (index != null) s.animateMode(index);
  };

  const modes = s.vibrations?.modes ?? [];

  return (
    <div className="panel spectrum-panel">
      <h3>Vibrations</h3>
      <div className="form-row">
        <label htmlFor="vib-ff">Force field</label>
        <select id="vib-ff" value={forceField} onChange={(e) => setForceField(e.target.value)}>
          {FORCE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row">
        <button
          className="primary"
          onClick={() => void compute()}
          disabled={s.busy !== null || doc.atoms.length < 2}
        >
          {s.busy === 'vibrations' ? 'Computing…' : 'Compute modes'}
        </button>
        <button onClick={() => outputFileInput.current?.click()}>Import output…</button>
        <input
          ref={outputFileInput}
          type="file"
          hidden
          aria-label="import quantum chemistry output"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importOutput(f);
          }}
        />
      </div>

      <OtherSpectra onError={onError} />

      {s.vibrations && (
        <>
          <p className="muted">
            {s.source} · {modes.length} modes
            {s.vibrations.linear != null && (s.vibrations.linear ? ' · linear' : '')}
            {s.vibrations.zero_point_energy != null && (
              <> · ZPE {s.vibrations.zero_point_energy.toFixed(4)} eV</>
            )}
          </p>
          <div className="form-row">
            <label htmlFor="vib-amp">Amplitude [Å]</label>
            <input
              id="vib-amp"
              type="number"
              min={0.01}
              max={3}
              step={0.05}
              value={s.amplitude}
              onChange={(e) => s.setAmplitude(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label htmlFor="vib-frames">Frames per period</label>
            <input
              id="vib-frames"
              type="number"
              min={4}
              max={120}
              step={2}
              value={s.framesPerPeriod}
              onChange={(e) => s.setFramesPerPeriod(Number(e.target.value))}
            />
          </div>
          <div className="button-row">
            <button
              onClick={() => s.animateMode(s.selectedMode)}
              disabled={s.selectedMode < 0}
              title="Animate the selected mode in the viewport"
            >
              Animate
            </button>
            <button onClick={s.stopAnimation} disabled={!animating}>
              Stop
            </button>
          </div>
          <div className="orbital-table-wrap">
            <table className="orbital-table" aria-label="normal modes">
              <thead>
                <tr>
                  <th>#</th>
                  <th>ν [cm⁻¹]</th>
                  <th>IR [km/mol]</th>
                  <th>Raman</th>
                  <th>sym</th>
                </tr>
              </thead>
              <tbody>
                {modes.map((m, i) => (
                  <tr
                    key={`${i}-${m.frequency}`}
                    className={i === s.selectedMode ? 'selected' : ''}
                    onClick={() => s.selectMode(i)}
                    onDoubleClick={() => s.animateMode(i)}
                  >
                    <td>{i + 1}</td>
                    <td>{formatFrequency(m.frequency).replace(' cm⁻¹', '')}</td>
                    <td>{m.ir_intensity == null ? '–' : m.ir_intensity.toFixed(2)}</td>
                    <td>{m.raman_activity == null ? '–' : m.raman_activity.toFixed(2)}</td>
                    <td>{m.symmetry ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.selectedMode >= 0 && modes[s.selectedMode] && (
            <p className="muted">
              Largest atom displacement {maxDisplacement(modes[s.selectedMode]!).toFixed(3)} ×
              amplitude
            </p>
          )}
        </>
      )}

      <h3>Spectra</h3>
      <div className="form-row">
        <label htmlFor="spec-active">Spectrum</label>
        <select
          id="spec-active"
          value={s.activeSpectrumId ?? ''}
          onChange={(e) => s.setActiveSpectrum(e.target.value || null)}
        >
          <option value="">None</option>
          {s.spectra.map((e) => (
            <option key={e.id} value={e.id}>
              {e.spectrum.name}
              {e.experimental ? ' (imported)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="spec-overlay">Overlay</label>
        <select
          id="spec-overlay"
          value={s.overlayId ?? ''}
          onChange={(e) => s.setOverlay(e.target.value || null)}
        >
          <option value="">None</option>
          {s.spectra.map((e) => (
            <option key={e.id} value={e.id}>
              {e.spectrum.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="spec-shape">Line shape</label>
        <select
          id="spec-shape"
          value={shape}
          onChange={(e) => setShape(e.target.value as LineShape)}
        >
          <option value="gaussian">Gaussian</option>
          <option value="lorentzian">Lorentzian</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="spec-width">Width (FWHM)</label>
        <input
          id="spec-width"
          type="number"
          min={0.1}
          step={1}
          value={width}
          onChange={(e) => setWidth(Math.max(0.1, Number(e.target.value)))}
        />
      </div>
      <div className="form-row">
        <label htmlFor="spec-scale">Scale frequencies</label>
        <input
          id="spec-scale"
          type="number"
          min={0.5}
          max={1.5}
          step={0.005}
          value={scaleFactor}
          onChange={(e) => setScaleFactor(Math.max(0.5, Number(e.target.value)))}
        />
      </div>
      <label className="form-advanced-toggle">
        <input
          type="checkbox"
          checked={transmittance}
          onChange={(e) => setTransmittance(e.target.checked)}
        />
        Transmittance (instead of absorbance)
      </label>
      <label className="form-advanced-toggle">
        <input type="checkbox" checked={raman} onChange={(e) => setRaman(e.target.checked)} />
        Raman activities
      </label>
      <label className="form-advanced-toggle">
        <input type="checkbox" checked={reverseX} onChange={(e) => setReverseX(e.target.checked)} />
        Reverse x axis
      </label>
      <div className="button-row">
        <button onClick={() => void rebroaden()} disabled={!s.vibrations}>
          Apply broadening
        </button>
        <button onClick={() => spectrumFileInput.current?.click()}>Import experimental…</button>
        <input
          ref={spectrumFileInput}
          type="file"
          hidden
          aria-label="import experimental spectrum"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importSpectrum(f);
          }}
        />
      </div>

      {active ? (
        <>
          <LineChart
            series={series}
            sticks={sticks}
            xReversed={reverseX && active.x.descending}
            xLabel={axisLabel(active.x)}
            yLabel={axisLabel(active.y)}
            title={active.name}
            height={240}
            onPick={pickPeak}
          />
          <p className="muted">Click a peak to animate the corresponding mode.</p>
        </>
      ) : (
        <p className="muted">No spectrum yet. Compute modes or import a file.</p>
      )}
    </div>
  );
}
