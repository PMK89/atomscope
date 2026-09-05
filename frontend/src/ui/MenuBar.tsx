import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { useViewStore } from '../state/viewStore';
import { useSelectionStore } from '../state/selectionStore';
import { useToolStore } from '../editor/toolStore';
import { atomsOfElement, invertSelection } from '../editor/selectionMath';
import { normalizeSymbol } from '../editor/cartesian';
import { CartesianEditor } from './CartesianEditor';
import { isEditableTarget } from '../editor/ToolHost';
import type { StructureStyle } from '../renderer/layers/StructureLayer';

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  checked?: boolean;
}

function Menu({ title, items }: { title: string; items: MenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={open ? 'menu-title open' : 'menu-title'} onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open && (
        <ul className="menu-list" role="menu">
          {items.map((it) => (
            <li key={it.label}>
              <button
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.action();
                }}
              >
                <span className="menu-check">{it.checked ? '•' : ''}</span>
                <span>{it.label}</span>
                {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MenuBar({ onError }: { onError: (msg: string) => void }): JSX.Element {
  const store = useStructureStore();
  const view = useViewStore();
  const selection = useSelectionStore();
  const openCartesian = useToolStore((s) => s.setCartesianEditorOpen);
  const fileInput = useRef<HTMLInputElement>(null);
  const trajectoryInput = useRef<HTMLInputElement>(null);

  const openTrajectory = async (file: File): Promise<void> => {
    try {
      const res = await api.io.importTrajectoryUpload(file);
      store.load(normalizeStructure(res.structure));
      useTrajectoryStore.getState().loadFromResult(res);
    } catch (e) {
      onError(`Trajectory import failed: ${(e as Error).message}`);
    }
  };

  const openFile = async (file: File): Promise<void> => {
    try {
      const s = await api.io.importUpload(file);
      store.load(normalizeStructure(s));
    } catch (e) {
      onError(`Import failed: ${(e as Error).message}`);
    }
  };

  const buildSmiles = async (): Promise<void> => {
    const smiles = window.prompt('SMILES');
    if (!smiles) return;
    try {
      store.load(normalizeStructure(await api.io.smiles({ smiles, add_hydrogens: true })));
    } catch (e) {
      onError(`SMILES failed: ${(e as Error).message}`);
    }
  };

  const exportText = async (format: string): Promise<void> => {
    try {
      const res = await api.io.export({ structure: store.doc, format });
      const blob = new Blob([res.text ?? ''], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${store.doc.name || 'structure'}.${format === 'extxyz' ? 'xyz' : format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      onError(`Export failed: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'o') {
        e.preventDefault();
        fileInput.current?.click();
      } else if (e.key === 'a' && !isEditableTarget(e.target)) {
        e.preventDefault();
        if (e.shiftKey) useSelectionStore.getState().clear();
        else useSelectionStore.getState().set(store.doc.atoms.map((_, i) => i));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const styleItem = (label: string, style: StructureStyle): MenuItem => ({
    label,
    checked: view.style === style,
    action: () => view.setStyle(style),
  });

  return (
    <header className="app-menubar" role="menubar">
      <span className="app-brand">Atomscope</span>
      <Menu
        title="File"
        items={[
          {
            label: 'New',
            action: () => store.load(normalizeStructure({ name: 'untitled', charge: 0 })),
          },
          { label: 'Open…', shortcut: 'Ctrl+O', action: () => fileInput.current?.click() },
          { label: 'Build from SMILES…', action: () => void buildSmiles() },
          { label: 'Import trajectory…', action: () => trajectoryInput.current?.click() },
          { label: 'Export XYZ', action: () => void exportText('xyz') },
          { label: 'Export extended XYZ', action: () => void exportText('extxyz') },
          { label: 'Export CIF', disabled: !store.doc.cell, action: () => void exportText('cif') },
        ]}
      />
      <Menu
        title="Edit"
        items={[
          {
            label: store.undoLabel() ? `Undo ${store.undoLabel()}` : 'Undo',
            shortcut: 'Ctrl+Z',
            disabled: !store.canUndo(),
            action: store.undo,
          },
          {
            label: store.redoLabel() ? `Redo ${store.redoLabel()}` : 'Redo',
            shortcut: 'Ctrl+Shift+Z',
            disabled: !store.canRedo(),
            action: store.redo,
          },
          {
            label: 'Select all',
            shortcut: 'Ctrl+A',
            action: () => selection.set(store.doc.atoms.map((_, i) => i)),
          },
          { label: 'Select none', shortcut: 'Ctrl+Shift+A', action: selection.clear },
          {
            label: 'Invert selection',
            action: () => selection.set(invertSelection(store.doc, selection.atoms)),
          },
          {
            label: 'Select by element…',
            action: () => {
              const sym = window.prompt('Element symbol');
              if (sym) selection.set(atomsOfElement(store.doc, normalizeSymbol(sym)));
            },
          },
          { label: 'Cartesian editor…', action: () => openCartesian(true) },
        ]}
      />
      <Menu
        title="View"
        items={[
          styleItem('Ball and stick', 'ball-and-stick'),
          styleItem('Stick', 'stick'),
          styleItem('Van der Waals spheres', 'vdw'),
          styleItem('Wireframe', 'wireframe'),
          { label: 'Show hydrogens', checked: view.showHydrogens, action: view.toggleHydrogens },
          {
            label: 'Orthographic projection',
            checked: view.projection === 'orthographic',
            action: () =>
              view.setProjection(
                view.projection === 'perspective' ? 'orthographic' : 'perspective',
              ),
          },
          { label: 'Fit to structure', action: view.requestFit },
          { label: 'Show force vectors', checked: view.showVectors, action: view.toggleVectors },
          { label: 'Show unit cell', checked: view.showUnitCell, action: view.toggleUnitCell },
          { label: 'Show axes', checked: view.showAxes, action: view.toggleAxes },
          {
            label: 'Background: white',
            checked: view.background === 'white',
            action: () => view.setBackground('white'),
          },
          {
            label: 'Background: black',
            checked: view.background === 'black',
            action: () => view.setBackground('black'),
          },
        ]}
      />
      <CartesianEditor />
      <input
        ref={fileInput}
        type="file"
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={trajectoryInput}
        type="file"
        hidden
        data-testid="trajectory-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openTrajectory(f);
          e.target.value = '';
        }}
      />
    </header>
  );
}
