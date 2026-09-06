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
  return registry;
}
