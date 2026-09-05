import { useEffect, useState } from 'react';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
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
  useEffect(() => {
    if (useStructureStore.getState().doc.atoms.length === 0) {
      useStructureStore.getState().load(demoWater());
    }
  }, []);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <div className="app-shell">
      <MenuBar onError={setError} />
      <main className="app-main">
        <aside className="app-dock app-dock-left">Project</aside>
        <section className="app-viewport">
          <Viewport />
        </section>
        <aside className="app-dock app-dock-right">Properties</aside>
      </main>
      <StatusBar message={error} />
    </div>
  );
}
