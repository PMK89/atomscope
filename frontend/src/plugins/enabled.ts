/**
 * The registry filtered by what is switched on. Every consumer of a contribution goes through
 * here rather than through the registry directly; the manager is the one place that wants the
 * full list, and it asks the registry itself.
 */
import { usePluginStore } from '../state/pluginStore';
import { usePlugins } from './context';
import type {
  ColorContribution,
  LayerContribution,
  MenuContribution,
  PanelContribution,
  PluginRegistry,
  ToolContribution,
} from './registry';

type Disabled = ReadonlySet<string>;

const on = (disabled: Disabled, kind: string, id: string): boolean =>
  !disabled.has(`${kind}:${id}`);

export const enabledTools = (r: PluginRegistry, d: Disabled): readonly ToolContribution[] =>
  r.tools().filter((c) => on(d, 'tool', c.tool.id));

export const enabledLayers = (r: PluginRegistry, d: Disabled): readonly LayerContribution[] =>
  r.layers().filter((c) => on(d, 'layer', c.id));

export const enabledPanels = (r: PluginRegistry, d: Disabled): readonly PanelContribution[] =>
  r.panels().filter((c) => on(d, 'panel', c.id));

export const enabledColorSchemes = (r: PluginRegistry, d: Disabled): readonly ColorContribution[] =>
  r.colorSchemes().filter((c) => on(d, 'color', c.id));

export const enabledMenuItems = (
  r: PluginRegistry,
  d: Disabled,
  menuPath: string,
): readonly MenuContribution[] => r.menuItems(menuPath).filter((c) => on(d, 'menu', c.id));

/** Everything switched off, as a set of `kind:id` keys. */
export function useDisabled(): Disabled {
  return usePluginStore((s) => s.disabled);
}

export function useTools(): readonly ToolContribution[] {
  return enabledTools(usePlugins(), useDisabled());
}

export function usePanels(): readonly PanelContribution[] {
  return enabledPanels(usePlugins(), useDisabled());
}

export function useColorSchemes(): readonly ColorContribution[] {
  return enabledColorSchemes(usePlugins(), useDisabled());
}
