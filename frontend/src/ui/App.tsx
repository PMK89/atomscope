import { useEffect } from 'react';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
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
  const load = useStructureStore((s) => s.load);
  const doc = useStructureStore((s) => s.doc);
  useEffect(() => {
    if (doc.atoms.length === 0) load(demoWater());
  }, [doc.atoms.length, load]);

  return (
    <div className="app-shell">
      <header className="app-menubar">Atomscope</header>
      <main className="app-main">
        <aside className="app-dock app-dock-left">Project</aside>
        <section className="app-viewport">
          <Viewport />
        </section>
        <aside className="app-dock app-dock-right">Properties</aside>
      </main>
      <footer className="app-console">Console</footer>
    </div>
  );
}
