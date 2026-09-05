import { useEffect, useState } from 'react';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { RightDock } from './RightDock';
import { ToolBar } from './ToolBar';
import { ToolSettings } from './ToolSettings';
import { JobConsole } from './JobConsole';
import { MenuBar } from './MenuBar';
import { ProjectPanel } from './ProjectPanel';
import { StatusBar } from './StatusBar';
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
  useEffect(() => {
    if (useStructureStore.getState().doc.atoms.length === 0) {
      useStructureStore.getState().load(demoWater());
    }
  }, []);
  // the window title carries the document and whether it has unsaved work, and leaving the page
  // with unsaved work asks first (the browser shows its own wording)
  const name = useStructureStore((s) => s.doc.name);
  const revision = useStructureStore((s) => s.revision);
  const savedRevision = useStructureStore((s) => s.savedRevision);
  const modified = revision !== savedRevision;
  useEffect(() => {
    document.title = `${modified ? '• ' : ''}${name} — Atomscope`;
  }, [name, modified]);
  useEffect(() => {
    if (!modified) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [modified]);
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
          <div className="app-editor">
            <ToolBar />
            <div className="app-viewport">
              <Viewport />
              <ToolSettings />
            </div>
          </div>
          <TrajectoryPlayer onError={setError} />
          <JobConsole />
        </section>
        <aside className="app-dock app-dock-right">
          <RightDock onError={setError} />
        </aside>
      </main>
      <StatusBar message={error} />
    </div>
  );
}
