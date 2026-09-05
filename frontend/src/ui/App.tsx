import { useEffect, useRef, useState } from 'react';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { droppedFile, hasFiles } from './fileDrop';
import { openUploadedFile } from './openFile';
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
  const modified = useStructureStore((s) => s.doc !== s.savedDoc);
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

  // A file dropped anywhere on the window opens, as it does in Avogadro. `depth` counts enter/leave
  // pairs: crossing into a child element fires a leave on the parent, and a naive flag would flicker.
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const onDragEnter = (e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return;
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent): void => {
    // without this the browser navigates to the file instead of handing it over
    if (hasFiles(e.dataTransfer)) e.preventDefault();
  };
  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const { file, message } = droppedFile([...e.dataTransfer.files]);
    if (!file) {
      setError(message);
      return;
    }
    openUploadedFile(file)
      .then((opened) => {
        // the message is about the files that were not opened: it is only true if one was
        if (opened && message) setError(message);
      })
      .catch((err: Error) => setError(`Open failed: ${err.message}`));
  };

  return (
    <div
      className="app-shell"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="app-dropzone" role="presentation">
          <p>Drop a file to open it</p>
        </div>
      )}
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
