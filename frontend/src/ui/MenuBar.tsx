import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { toApiStructure } from '../api/structureBody';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { useViewStore } from '../state/viewStore';
import { useRendererStore } from '../state/rendererStore';
import { useSelectionStore } from '../state/selectionStore';
import { useToolStore } from '../editor/toolStore';
import {
  atomsOfElement,
  atomsOfResidues,
  invertSelection,
  solventAtoms,
} from '../editor/selectionMath';
import { normalizeSymbol } from '../editor/cartesian';
import { CartesianEditor } from './CartesianEditor';
import { redoEdit, undoEdit } from './historyActions';
import { ConstraintsDialog } from './ConstraintsDialog';
import { SpeciesDialog } from './SpeciesDialog';
import { NamedSelectionsDialog } from './NamedSelectionsDialog';
import { useRecentStore } from '../state/recentStore';
import { addNamed, resolveNamed } from '../editor/namedSelections';
import { SettingsDialog } from './SettingsDialog';
import { BuildDialogs } from './BuildDialogs';
import { CrystalDialogs } from './CrystalDialogs';
import { useBuildStore } from '../state/buildStore';
import { useCrystalStore } from '../state/crystalStore';
import { toggleCell } from './crystalActions';
import {
  addHydrogens,
  assignPartialCharges,
  copyIdentifier,
  generate3d,
  hydrogenToMethyl,
  invertChirality,
  optimizeGeometry,
  perceiveBonds,
  removeHydrogens,
} from './chemActions';
import {
  clearSelection,
  copySelection,
  copyToSystemClipboard,
  cutSelection,
  installClipboardEvents,
  pasteFromClipboard,
} from './clipboardActions';
import { promptSaveAs, saveStructure } from './fileActions';
import { isEditableTarget } from '../editor/ToolHost';
import { ExportImageDialog } from './ExportImageDialog';
import { HelpDialog, type HelpTopic } from './HelpDialog';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';
import { isFlat, offerGeometry } from './buildGeometry';
import { confirmReplace } from './replaceDocument';
import { Menu, type MenuItem } from './Menu';
import { usePlugins } from '../plugins/context';
import type { StructureStyle } from '../renderer/layers/StructureLayer';

export function MenuBar({ onError }: { onError: (msg: string) => void }): JSX.Element {
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [namedOpen, setNamedOpen] = useState(false);
  // subscribed one field at a time: the whole store would re-render the bar on every change
  const recentFiles = useRecentStore((s) => s.files);
  const refreshRecent = useRecentStore((s) => s.refresh);
  const clearRecent = useRecentStore((s) => s.clear);
  useEffect(() => void refreshRecent(), [refreshRecent]);
  const [exportImage, setExportImage] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const store = useStructureStore();
  const view = useViewStore();
  const selection = useSelectionStore();
  const openCartesian = useToolStore((s) => s.setCartesianEditorOpen);
  const openConstraints = useToolStore((s) => s.setConstraintsDialogOpen);
  const openSettings = useToolStore((s) => s.setSettingsDialogOpen);
  const openCrystalDialog = useCrystalStore((s) => s.openDialog);
  const openBuildDialog = useBuildStore((s) => s.openDialog);
  const trajectoryInput = useRef<HTMLInputElement>(null);

  const openTrajectory = async (file: File): Promise<void> => {
    if (!confirmReplace()) return;
    try {
      const res = await api.io.importTrajectoryUpload(file);
      store.load(normalizeStructure(res.structure));
      useTrajectoryStore.getState().loadFromResult(res);
    } catch (e) {
      onError(`Trajectory import failed: ${(e as Error).message}`);
    }
  };

  const selectSmarts = async (pattern: string): Promise<void> => {
    try {
      const { atoms } = await api.chem.smarts({
        structure: toApiStructure(store.doc),
        pattern,
        unique: true,
      });
      selection.set(atoms);
      if (atoms.length === 0) onError(`No atom matches ${pattern}`);
    } catch (e) {
      onError(`SMARTS selection failed: ${(e as Error).message}`);
    }
  };

  const buildSmiles = async (): Promise<void> => {
    if (!confirmReplace()) return;
    const smiles = window.prompt('SMILES');
    if (!smiles) return;
    try {
      store.load(normalizeStructure(await api.io.smiles({ smiles, add_hydrogens: true })));
    } catch (e) {
      onError(`SMILES failed: ${(e as Error).message}`);
    }
  };

  /**
   * Avogadro's Fetch from PDB / Fetch by chemical name. What is typed is an *identifier*, which
   * the backend validates and puts into one path segment of a fixed address -- there is no
   * fetch-from-URL, which would be this process making a request to wherever it was told.
   */
  /** Avogadro's Open Recent: the backend keeps the list, so it outlives the browser session. */
  const openRecent = async (path: string): Promise<void> => {
    if (!confirmReplace()) return;
    try {
      store.load(normalizeStructure(await api.io.importPath({ path })));
      await offerGeometry(onError);
      void refreshRecent();
    } catch (e) {
      onError(`Open failed: ${(e as Error).message}`);
    }
  };

  const fetchStructure = async (source: 'pdb' | 'pubchem', query: string): Promise<void> => {
    if (!confirmReplace()) return;
    try {
      store.load(normalizeStructure(await api.io.fetch({ source, query })));
    } catch (e) {
      onError(`Fetch failed: ${(e as Error).message}`);
    }
  };

  /**
   * Avogadro's POV-Ray export: the scene as a ray-tracer's source file, downloaded like an image.
   * It is written from the renderer's own scene, so it is what the viewport shows.
   */
  const exportPov = (): void => {
    const renderer = useRendererStore.getState().renderer;
    if (!renderer) {
      onError('No viewport to export');
      return;
    }
    const blob = new Blob([renderer.exportPov()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${store.doc.name || 'structure'}.pov`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      // text fields keep their native undo/redo/select-all
      if ((key === 'z' || key === 'y' || key === 'a') && isEditableTarget(e.target)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoEdit();
      } else if (key === 'o') {
        e.preventDefault();
        setImportOpen(true);
      } else if (key === 'a') {
        e.preventDefault();
        if (e.shiftKey) useSelectionStore.getState().clear();
        else useSelectionStore.getState().set(store.doc.atoms.map((_, i) => i));
      } else if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) void promptSaveAs(onError);
        else void saveStructure(onError);
      } else if (key === 'backspace' && !isEditableTarget(e.target)) {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, onError]);

  // Ctrl+X/C/V arrive as clipboard events, which carry the data without asking for permission
  useEffect(() => installClipboardEvents(onError), [onError]);

  // contributed items go under the built-in ones of the menu they name (plugins/registry.ts)
  const registry = usePlugins();
  const contributed = (menu: string): MenuItem[] => [...registry.menuItems(menu)];
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
            action: () => {
              if (confirmReplace()) store.load(normalizeStructure({ name: 'untitled', charge: 0 }));
            },
          },
          { label: 'Open…', shortcut: 'Ctrl+O', action: () => setImportOpen(true) },
          // Avogadro's Open Recent submenu, flat: the menu here has one level
          ...recentFiles.map((f) => ({
            label: f.exists ? f.name : `${f.name} (missing)`,
            action: () => void openRecent(f.path),
            disabled: !f.exists,
          })),
          ...(recentFiles.length > 0
            ? [{ label: 'Clear recent', action: () => void clearRecent() }]
            : []),
          {
            label: 'Save',
            shortcut: 'Ctrl+S',
            action: () => void saveStructure(onError),
          },
          {
            label: 'Save as…',
            shortcut: 'Ctrl+Shift+S',
            action: () => void promptSaveAs(onError),
          },
          { label: 'Build from SMILES…', action: () => void buildSmiles() },
          {
            label: 'Fetch from PDB…',
            action: () => {
              const id = window.prompt('PDB id', '1CRN');
              if (id) void fetchStructure('pdb', id);
            },
          },
          {
            label: 'Fetch by name…',
            action: () => {
              const name = window.prompt('Chemical name', 'caffeine');
              if (name) void fetchStructure('pubchem', name);
            },
          },
          { label: 'Import trajectory…', action: () => trajectoryInput.current?.click() },
          { label: 'Export…', action: () => setExportOpen(true) },
          { label: 'Export image…', action: () => setExportImage(true) },
          { label: 'Export POV-Ray scene', action: exportPov },
          ...contributed('File'),
        ]}
      />
      <Menu
        title="Edit"
        items={[
          {
            label: store.undoLabel() ? `Undo ${store.undoLabel()}` : 'Undo',
            shortcut: 'Ctrl+Z',
            disabled: !store.canUndo(),
            action: undoEdit,
          },
          {
            label: store.redoLabel() ? `Redo ${store.redoLabel()}` : 'Redo',
            shortcut: 'Ctrl+Shift+Z',
            disabled: !store.canRedo(),
            action: redoEdit,
          },
          {
            label: 'Cut',
            shortcut: 'Ctrl+X',
            disabled: store.doc.atoms.length === 0,
            action: () => {
              const text = copySelection();
              if (text) {
                void copyToSystemClipboard(text);
                cutSelection();
              }
            },
          },
          {
            label: 'Copy',
            shortcut: 'Ctrl+C',
            disabled: store.doc.atoms.length === 0,
            action: () => {
              const text = copySelection();
              if (text) void copyToSystemClipboard(text);
            },
          },
          { label: 'Paste', shortcut: 'Ctrl+V', action: () => void pasteFromClipboard(onError) },
          {
            label: 'Clear',
            shortcut: 'Ctrl+Backspace',
            disabled: store.doc.atoms.length === 0,
            action: clearSelection,
          },
          { label: 'Cartesian editor…', action: () => openCartesian(true) },
          ...contributed('Edit'),
        ]}
      />
      <Menu
        title="Select"
        items={[
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
          {
            label: 'Select residues…',
            disabled: store.doc.residues.length === 0,
            action: () => {
              const spec = window.prompt('Residue names, numbers or ranges (LYS, 12, A:12-20)');
              if (spec) selection.set(atomsOfResidues(store.doc, spec));
            },
          },
          {
            label: 'Select solvent',
            disabled: store.doc.residues.length === 0,
            action: () => selection.set(solventAtoms(store.doc)),
          },
          {
            label: 'Select SMARTS…',
            action: () => {
              const pattern = window.prompt('SMARTS pattern', '[OX2H]');
              if (pattern) void selectSmarts(pattern);
            },
          },
          {
            label: 'Add named selection…',
            disabled: selection.atoms.size === 0,
            action: () => {
              const name = window.prompt('Name for this selection');
              if (name)
                selection.setNamed(addNamed(selection.named, name, store.doc, selection.atoms));
            },
          },
          { label: 'Named selections…', action: () => setNamedOpen(true) },
          // each saved set recalls itself, which is Avogadro's project-tree entry as a menu item
          ...selection.named.map((entry) => {
            const atoms = resolveNamed(store.doc, entry);
            return {
              label: entry.name,
              action: () => selection.set(atoms),
              disabled: atoms.length === 0,
            };
          }),
          ...contributed('Select'),
        ]}
      />
      <Menu
        title="Build"
        items={[
          { label: 'Insert fragment…', action: () => openBuildDialog('fragment') },
          { label: 'Insert peptide…', action: () => openBuildDialog('peptide') },
          { label: 'Insert nucleic acid…', action: () => openBuildDialog('nucleic') },
          { label: 'Insert nanotube or graphene…', action: () => openBuildDialog('nanotube') },
          {
            // Avogadro only offered this on load; here a No is not final. Only while the
            // document is flat: the builder discards the coordinates it is given, so on a real
            // geometry this would replace it with a rough one.
            label: 'Generate 3D coordinates',
            disabled: !isFlat(store.doc),
            action: () => void generate3d(onError),
          },
          {
            label: store.doc.cell ? 'Remove unit cell' : 'Add unit cell',
            action: () => void toggleCell(onError),
          },
          {
            label: 'Supercell…',
            disabled: !store.doc.cell,
            action: () => openCrystalDialog('supercell'),
          },
          { label: 'Slab…', disabled: !store.doc.cell, action: () => openCrystalDialog('slab') },
          { label: 'Crystal library…', action: () => openCrystalDialog('library') },
          ...contributed('Build'),
        ]}
      />
      <Menu
        title="Extensions"
        items={[
          { label: 'Add hydrogens', action: () => void addHydrogens(onError) },
          {
            label: 'Add hydrogens for pH…',
            action: () => {
              const ph = Number(window.prompt('pH', '7.4'));
              if (Number.isFinite(ph)) void addHydrogens(onError, ph);
            },
          },
          { label: 'Remove hydrogens', action: () => void removeHydrogens(onError) },
          { label: 'Perceive bonds', action: () => void perceiveBonds(onError) },
          { label: 'Optimize geometry (MMFF94)', action: () => void optimizeGeometry(onError) },
          { label: 'Constraints…', action: () => openConstraints(true) },
          {
            label: 'Assign partial charges',
            action: () => void assignPartialCharges(onError),
          },
          // the status bar is the only transient-message channel, so a success notice goes there
          {
            label: 'Copy as SMILES',
            action: () => void copyIdentifier('smiles', onError, onError),
          },
          { label: 'Copy as InChI', action: () => void copyIdentifier('inchi', onError, onError) },
          { label: 'Invert chirality', action: () => void invertChirality(onError) },
          { label: 'Hydrogen → methyl', action: () => void hydrogenToMethyl(onError) },
          ...contributed('Extensions'),
        ]}
      />
      <Menu
        title="Settings"
        items={[
          { label: 'Preferences…', action: () => openSettings(true) },
          ...contributed('Settings'),
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
          { label: 'Centre', action: view.requestCenter },
          { label: 'Show force vectors', checked: view.showVectors, action: view.toggleVectors },
          { label: 'Show dipole moment', checked: view.showDipole, action: view.toggleDipole },
          { label: 'Show unit cell', checked: view.showUnitCell, action: view.toggleUnitCell },
          { label: 'Show axes', checked: view.showAxes, action: view.toggleAxes },
          // what the labels say is chosen in the Display tab; the menu only switches them on
          { label: 'Show labels', checked: view.showLabels, action: view.toggleLabels },
          // a chosen colour wins over the preset, so neither preset is what is on screen then
          {
            label: 'Background: white',
            checked: !view.backgroundColor && view.background === 'white',
            action: () => view.setBackground('white'),
          },
          {
            label: 'Background: black',
            checked: !view.backgroundColor && view.background === 'black',
            action: () => view.setBackground('black'),
          },
          ...contributed('View'),
        ]}
      />
      <Menu
        title="Help"
        items={[
          { label: 'User guide (docs/user-guide.md)', action: () => setHelp('user-guide') },
          { label: 'Tutorials (docs/tutorials/)', action: () => setHelp('tutorials') },
          { label: 'Keyboard shortcuts', action: () => setHelp('shortcuts') },
          { label: 'About Atomscope', action: () => setHelp('about') },
          ...contributed('Help'),
        ]}
      />
      {registry
        .extraMenus(['File', 'Edit', 'Select', 'Build', 'Extensions', 'Settings', 'View', 'Help'])
        .map((menu) => (
          <Menu key={menu} title={menu} items={contributed(menu)} />
        ))}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onError={onError} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} onError={onError} />
      <ExportImageDialog
        open={exportImage}
        onClose={() => setExportImage(false)}
        onError={onError}
      />
      <HelpDialog topic={help} onClose={() => setHelp(null)} />
      <CartesianEditor />
      <ConstraintsDialog />
      <SpeciesDialog onError={onError} />
      <NamedSelectionsDialog open={namedOpen} onClose={() => setNamedOpen(false)} />
      <SettingsDialog />
      <CrystalDialogs onError={onError} />
      <BuildDialogs onError={onError} />
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
