import { useEffect, useState } from 'react';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { CalculationPanel } from './CalculationPanel';
import { JobConsole } from './JobConsole';
import { MenuBar } from './MenuBar';
import { ProjectPanel } from './ProjectPanel';
import { StatusBar } from './StatusBar';
import { SurfacesPanel } from './SurfacesPanel';
import { TrajectoryPlayer } from './TrajectoryPlayer';
import { Viewport } from './Viewport';

function demoWater() {
  return normalizeStructure({
    name: 'water',
    charge: 0,
    atoms: [
      makeAtom('O', [0, 0, 0.1173]),
      makeAtom('H', [0, 0.7572, -0.4692]),
      makeAtom('H', [0, -0.7572, -0.4692]),
    ],
    bonds: [makeBond(0, 1), makeBond(0, 2)],
  });
}

export function App(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [dock, setDock] = useState<'calculation' | 'surfaces'>('calculation');
  useEffect(() => {
    if (useStructureStore.getState().doc.atoms.length === 0) {
      useStructureStore.getState().load(demoWater());
    }
  }, []);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <div className="app-shell">
      <MenuBar onError={setError} />
      <main className="app-main">
        <aside className="app-dock app-dock-left">
          <ProjectPanel onError={setError} />
        </aside>
        <section className="app-center">
          <div className="app-viewport">
            <Viewport />
          </div>
          <TrajectoryPlayer onError={setError} />
          <JobConsole />
        </section>
        <aside className="app-dock app-dock-right">
          <div className="tabs dock-tabs">
            {(['calculation', 'surfaces'] as const).map((t) => (
              <button
                key={t}
                className={dock === t ? 'tab active' : 'tab'}
                onClick={() => setDock(t)}
              >
                {t === 'calculation' ? 'Calculation' : 'Surfaces'}
              </button>
            ))}
          </div>
          {dock === 'calculation' ? (
            <CalculationPanel onError={setError} />
          ) : (
            <SurfacesPanel onError={setError} />
          )}
        </aside>
      </main>
      <StatusBar message={error} />
    </div>
  );
}
