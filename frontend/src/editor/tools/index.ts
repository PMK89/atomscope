import type { Tool } from '../Tool';
import { AutoRotateTool } from './AutoRotateTool';
import { BondCentricTool } from './BondCentricTool';
import { DrawTool } from './DrawTool';
import { ManipulateTool } from './ManipulateTool';
import { MeasureTool } from './MeasureTool';
import { NavigateTool } from './NavigateTool';
import { SelectTool } from './SelectTool';

/** Fresh tool instances in toolbar order. */
export function createTools(): Tool[] {
  return [
    new NavigateTool(),
    new SelectTool(),
    new DrawTool(),
    new ManipulateTool(),
    new BondCentricTool(),
    new MeasureTool(),
    new AutoRotateTool(),
  ];
}

/** Static metadata for UI (toolbar, shortcuts) without instantiating stateful tools. */
export const TOOL_INFO = createTools().map((t) => ({
  id: t.id,
  label: t.label,
  icon: t.icon,
  shortcut: t.shortcut,
  description: t.description,
}));
