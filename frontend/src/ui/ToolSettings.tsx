import { useToolStore } from '../editor/toolStore';
import { usePlugins } from '../plugins/context';

/** Floating panel over the viewport with the active tool's settings. */
export function ToolSettings(): JSX.Element {
  const active = useToolStore((s) => s.active);
  const contribution = usePlugins().tool(active);
  const Settings = contribution?.settings;
  return (
    <div className="tool-settings panel" data-testid="tool-settings">
      <h4>{contribution?.tool.label}</h4>
      {Settings ? <Settings /> : <p className="muted">{contribution?.tool.description}</p>}
    </div>
  );
}
