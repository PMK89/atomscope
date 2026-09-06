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
import { CalculationPanel } from '../ui/CalculationPanel';
import { CrystalPanel } from '../ui/CrystalPanel';
import { DisplayPanel } from '../ui/DisplayPanel';
import { PropertiesPanel } from '../ui/PropertiesPanel';
import { SpectrumPanel } from '../ui/SpectrumPanel';
import { SurfacesPanel } from '../ui/SurfacesPanel';
import { AxesLayer } from '../renderer/layers/AxesLayer';
import { DipoleLayer } from '../renderer/layers/DipoleLayer';
import { HBondLayer } from '../renderer/layers/HBondLayer';
import { LabelLayer } from '../renderer/layers/LabelLayer';
import { RibbonLayer } from '../renderer/layers/RibbonLayer';
import { UnitCellLayer } from '../renderer/layers/UnitCellLayer';
import { VectorLayer } from '../renderer/layers/VectorLayer';
import { PluginRegistry } from './registry';

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
  registry.registerLayer({ id: 'vectors', create: () => new VectorLayer() });
  registry.registerLayer({ id: 'dipole', create: () => new DipoleLayer() });
  registry.registerLayer({ id: 'unit-cell', create: () => new UnitCellLayer() });
  registry.registerLayer({ id: 'axes', create: () => new AxesLayer() });
  registry.registerLayer({ id: 'labels', create: () => new LabelLayer() });
  registry.registerLayer({ id: 'ribbon', create: () => new RibbonLayer() });
  registry.registerLayer({ id: 'hbonds', create: () => new HBondLayer() });
  registry.registerPanel({ id: 'calculation', label: 'Calculation', render: CalculationPanel });
  registry.registerPanel({ id: 'analysis', label: 'Analysis', render: AnalysisPanel });
  registry.registerPanel({ id: 'spectra', label: 'Spectra', render: SpectrumPanel });
  registry.registerPanel({ id: 'surfaces', label: 'Surfaces', render: SurfacesPanel });
  registry.registerPanel({ id: 'display', label: 'Display', render: () => <DisplayPanel /> });
  registry.registerPanel({ id: 'crystal', label: 'Crystal', render: CrystalPanel });
  registry.registerPanel({ id: 'properties', label: 'Properties', render: PropertiesPanel });
  return registry;
}
