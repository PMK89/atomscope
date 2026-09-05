/**
 * NMR, UV-Vis and CD spectra from an imported output file.
 *
 * These do not come from a mode list, so they sit beside the vibrational controls rather than
 * inside them: an output with only NMR shieldings (or only TD-DFT transitions) is a perfectly
 * good spectrum source, and used to be reported as "no vibrational data".
 */
import { useState } from 'react';
import { api } from '../api/client';
import { useSpectrumStore } from '../state/spectrumStore';

export function OtherSpectra({ onError }: { onError: (m: string) => void }): JSX.Element | null {
  const shieldings = useSpectrumStore((s) => s.shieldings);
  const transitions = useSpectrumStore((s) => s.transitions);
  const addSpectrum = useSpectrumStore((s) => s.addSpectrum);
  const [element, setElement] = useState('');
  const [reference, setReference] = useState(0);
  const [circular, setCircular] = useState(false);
  const [busy, setBusy] = useState(false);

  const elements = [...new Set(shieldings.map((s) => s.element))];
  const nucleus = element || elements[0] || '';
  if (elements.length === 0 && transitions.length === 0) return null;

  const run = async (make: () => Promise<Parameters<typeof addSpectrum>[0]>): Promise<void> => {
    setBusy(true);
    try {
      addSpectrum(await make(), false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {elements.length > 0 && (
        <>
          <h3>NMR</h3>
          <p className="muted">{shieldings.length} calculated shieldings</p>
          <div className="form-row">
            <label htmlFor="nmr-element">Nucleus</label>
            <select id="nmr-element" value={nucleus} onChange={(e) => setElement(e.target.value)}>
              {elements.map((el) => (
                <option key={el} value={el}>
                  {el}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="nmr-reference">Reference (ppm)</label>
            <input
              id="nmr-reference"
              type="number"
              step="0.1"
              value={reference}
              onChange={(e) => setReference(Number(e.target.value))}
            />
          </div>
          <p className="muted">
            The shielding of the standard from the same calculation; 0 plots negated absolute
            shieldings.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  // the backend's own defaults; the generated request type spells them out
                  api.analysis.nmr({
                    shieldings,
                    element: nucleus,
                    reference,
                    width: 0.05,
                    shape: 'lorentzian',
                    points: 1000,
                  }),
                )
              }
            >
              Plot NMR
            </button>
          </div>
        </>
      )}

      {transitions.length > 0 && (
        <>
          <h3>Electronic</h3>
          <p className="muted">{transitions.length} transitions</p>
          <div className="form-row">
            <label htmlFor="uvvis-cd">Circular dichroism</label>
            <input
              id="uvvis-cd"
              type="checkbox"
              checked={circular}
              onChange={(e) => setCircular(e.target.checked)}
            />
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api.analysis.electronic({
                    transitions,
                    circular_dichroism: circular,
                    width: 20,
                    shape: 'gaussian',
                    points: 1000,
                  }),
                )
              }
            >
              {circular ? 'Plot CD' : 'Plot UV-Vis'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
