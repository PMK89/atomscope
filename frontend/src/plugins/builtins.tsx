/**
 * The built-in contributions. Everything the application ships is registered here, through the
 * same calls a plugin would use, which is what keeps the registry honest: if a built-in needs
 * something the contribution types cannot say, the types are wrong.
 */
import { AutoOptimizeTool } from '../editor/tools/AutoOptimizeTool';
import { AutoRotateTool } from '../editor/tools/AutoRotateTool';
import { BondCentricTool } from '../editor/tools/BondCentricTool';
import { DrawTool } from '../editor/tools/DrawTool';
import { ManipulateTool } from '../editor/tools/ManipulateTool';
import { MeasureTool } from '../editor/tools/MeasureTool';
import { NavigateTool } from '../editor/tools/NavigateTool';
import { SelectTool } from '../editor/tools/SelectTool';
import {
  AutoOptimizeSettings,
  AutoRotateSettings,
  BondCentricSettings,
  DrawSettings,
  ManipulateSettings,
  MeasureReadout,
  SelectSettings,
} from '../ui/toolPanels';
import { AnalysisPanel } from '../ui/AnalysisPanel';
import { DatabasePanel } from '../ui/DatabasePanel';
import { SweepPanel } from '../ui/SweepPanel';
import { CalculationPanel } from '../ui/CalculationPanel';
import { CrystalPanel } from '../ui/CrystalPanel';
import { DisplayPanel } from '../ui/DisplayPanel';
import { PropertiesPanel } from '../ui/PropertiesPanel';
import { NebPanel } from '../ui/NebPanel';
import { SpectrumPanel } from '../ui/SpectrumPanel';
import { SurfacesPanel } from '../ui/SurfacesPanel';
import { AxesLayer } from '../renderer/layers/AxesLayer';
import { DipoleLayer } from '../renderer/layers/DipoleLayer';
import { HBondLayer } from '../renderer/layers/HBondLayer';
import { LabelLayer } from '../renderer/layers/LabelLayer';
import { RibbonLayer } from '../renderer/layers/RibbonLayer';
import { UnitCellLayer } from '../renderer/layers/UnitCellLayer';
import { VectorLayer } from '../renderer/layers/VectorLayer';
import { atomColors, COLOR_SCHEMES } from '../renderer/atomColors';
import { PluginRegistry, type ColorContext } from './registry';

let application: PluginRegistry | null = null;

/** The application's own registry, built once. `App` provides it; tests build their own. */
export function plugins(): PluginRegistry {
  application ??= defaultRegistry();
  return application;
}

/** A registry with everything the application ships, in toolbar order. */
export function defaultRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.registerTool({ tool: new NavigateTool() });
  registry.registerTool({ tool: new SelectTool(), settings: SelectSettings });
  registry.registerTool({ tool: new DrawTool(), settings: DrawSettings });
  registry.registerTool({ tool: new ManipulateTool(), settings: ManipulateSettings });
  registry.registerTool({ tool: new BondCentricTool(), settings: BondCentricSettings });
  registry.registerTool({ tool: new MeasureTool(), settings: MeasureReadout });
  registry.registerTool({ tool: new AutoOptimizeTool(), settings: AutoOptimizeSettings });
  registry.registerTool({ tool: new AutoRotateTool(), settings: AutoRotateSettings });
  // the structure layer is the renderer's own and is not contributed: it is what a renderer is
  registry.registerLayer({
    id: 'vectors',
    name: 'Atomic vectors',
    description: 'Arrows for a per-atom vector field, such as forces or a normal mode.',
    create: () => new VectorLayer(),
  });
  registry.registerLayer({
    id: 'dipole',
    name: 'Dipole moment',
    description: 'One arrow for the dipole the partial charges imply.',
    create: () => new DipoleLayer(),
  });
  registry.registerLayer({
    id: 'unit-cell',
    name: 'Unit cell',
    description: 'The cell edges, repeated as many times as the crystal panel asks.',
    create: () => new UnitCellLayer(),
  });
  registry.registerLayer({
    id: 'axes',
    name: 'Axes',
    description: 'A corner gizmo showing which way x, y and z point.',
    create: () => new AxesLayer(),
  });
  registry.registerLayer({
    id: 'labels',
    name: 'Labels',
    description: 'Text beside every atom and bond, of whatever the display panel chooses.',
    create: () => new LabelLayer(),
  });
  registry.registerLayer({
    id: 'ribbon',
    name: 'Ribbons',
    description: 'Cartoon secondary structure for a protein or a nucleic acid.',
    create: () => new RibbonLayer(),
  });
  registry.registerLayer({
    id: 'hbonds',
    name: 'Hydrogen bonds',
    description: 'Dashed lines between donors and acceptors within the cut-offs.',
    create: () => new HBondLayer(),
  });
  // the built-in schemes share one implementation (`renderer/atomColors.ts`), which is what the
  // dispatch inside it is; what the registry owns is the list, so a contributed scheme needs no
  // entry there and no branch of that function
  for (const scheme of COLOR_SCHEMES) {
    registry.registerColorScheme({
      id: scheme.id,
      label: scheme.label,
      description: scheme.description,
      colors: (ctx: ColorContext) =>
        atomColors(ctx.residues, ctx.atomCount, scheme.id, ctx.secondary, {
          atoms: ctx.atoms,
          charges: ctx.charges,
          custom: ctx.custom,
          palette: ctx.palette,
        }),
    });
  }
  registry.registerPanel({
    id: 'calculation',
    label: 'Calculation',
    description: 'Set a calculation up for a backend and generate or run it.',
    component: CalculationPanel,
  });
  registry.registerPanel({
    id: 'analysis',
    label: 'Analysis',
    description: 'What a finished run produced: energies, geometries, densities of states.',
    component: AnalysisPanel,
  });
  registry.registerPanel({
    id: 'sweeps',
    label: 'Sweeps',
    description:
      'Several calculations that differ in one way — a cutoff, a cell size, a volume — read as one curve.',
    component: SweepPanel,
  });
  registry.registerPanel({
    id: 'database',
    label: 'Database',
    description:
      "The project's ASE database: finished calculations selected by the elements in them, by charge and spin, or by any parameter they were run with.",
    component: DatabasePanel,
  });
  registry.registerPanel({
    id: 'neb',
    label: 'Path',
    description: 'A nudged elastic band between this structure and another, and its barrier.',
    component: NebPanel,
  });
  registry.registerPanel({
    id: 'spectra',
    label: 'Spectra',
    description: 'Vibrational, UV/Vis and NMR spectra from a run that has them.',
    component: SpectrumPanel,
  });
  registry.registerPanel({
    id: 'surfaces',
    label: 'Surfaces',
    description: 'Isosurfaces from a cube file or from a wavefunction.',
    component: SurfacesPanel,
  });
  registry.registerPanel({
    id: 'display',
    label: 'Display',
    description: 'How the structure is drawn: representation, colours, labels, layers.',
    component: () => <DisplayPanel />,
  });
  registry.registerPanel({
    id: 'crystal',
    label: 'Crystal',
    description: 'The unit cell, its symmetry and the supercell to show.',
    component: CrystalPanel,
  });
  registry.registerPanel({
    id: 'properties',
    label: 'Properties',
    description: 'The selected atoms and the structure itself, editable.',
    component: PropertiesPanel,
  });
  return registry;
}
