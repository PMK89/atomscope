/**
 * The contribution registry (AV-PLUG-001).
 *
 * Avogadro's plugins were shared libraries scanned for and dlopen'd at start-up. A Vite bundle
 * has no such loader, so ours are modules linked at build time and a third-party plugin means a
 * rebuild. What the registry buys is the other half of what Avogadro's bought: nothing in the
 * application enumerates its tools, layers, panels or menu items any more -- each is contributed,
 * and the built-ins are simply the first contributors.
 *
 * The registry is an object rather than a module-level list so a test can build one of its own;
 * `PluginProvider` (context.tsx) is how a component is given one.
 */
import type { Tool } from '../editor/Tool';
import type { DisplayLayer } from '../renderer/layers/Layer';
import type { MenuItem } from '../ui/Menu';
import type { SecondaryStructureData } from '../renderer/layers/RibbonLayer';
import type { ResiduePalette } from '../renderer/atomColors';
import type { StructureDoc } from '../model/structure';

export type ErrorSink = (message: string) => void;

/** Avogadro's plugin types, less `Other`, which nothing of ours is (`libavogadro/plugin.h:58`). */
export type PluginKind = 'tool' | 'layer' | 'panel' | 'menu' | 'color';

/** One row of the Plugin Manager: what every contribution can say about itself. */
export interface PluginItem {
  kind: PluginKind;
  id: string;
  name: string;
  description: string;
  /** False for the two that everything else falls back to: they cannot be turned off. */
  removable: boolean;
}

export interface ToolContribution {
  /**
   * The tool itself, one instance for the registry's life. Tools carry gesture state and no
   * graphics, and one Viewport is mounted at a time, so a second instance would have nothing to
   * do; a layer contribution will have to be a factory instead, since a layer owns Three objects
   * that belong to one renderer and are disposed with it.
   */
  tool: Tool;
  /** Body of the floating tool-settings box; a tool without one shows its description. */
  settings?: () => JSX.Element;
}

export interface LayerContribution {
  id: string;
  /** What the Plugin Manager shows for it. */
  name: string;
  description: string;
  /**
   * A factory, not an instance: a layer owns Three.js objects that belong to one renderer and
   * are disposed with it, so a second Viewport needs layers of its own. (A tool, which owns only
   * gesture state, is contributed as an instance.)
   */
  create: () => DisplayLayer;
}

export interface PanelContribution {
  /** Stable: it is what the open tab is remembered under in this browser. */
  id: string;
  label: string;
  description: string;
  /**
   * The panel's body, rendered as a component (`<Panel onError={...} />`), so it may use hooks.
   * Panels stay mounted while another tab is open, which is what keeps their form state.
   */
  component: (props: { onError: ErrorSink }) => JSX.Element;
}

/** Everything a colour scheme is given; the same arguments `atomColors` has always taken. */
export interface ColorContext {
  residues: StructureDoc['residues'];
  atomCount: number;
  secondary: SecondaryStructureData | null;
  atoms: StructureDoc['atoms'] | null;
  charges: readonly number[] | null;
  /** the colour of the `custom` scheme, as `#rrggbb` */
  custom: string;
  palette: ResiduePalette;
}

export interface ColorContribution {
  id: string;
  label: string;
  description: string;
  /** Three floats per atom, or null to leave the atoms the colours of their elements. */
  colors: (ctx: ColorContext) => Float32Array | null;
}

export interface MenuContribution extends MenuItem {
  /** Its own, so the Plugin Manager can name it: a label is not a key. */
  id: string;
  description: string;
  /**
   * The menu the item belongs under: one level, a top menu's title. A path naming a menu that is
   * there (`File`, `Extensions`, ...) appends to it, below everything built in; any other name
   * makes a menu of its own, after the built-in ones and in registration order. Submenus would be
   * a second level and `Menu` has only one, so a path with a `/` in it is refused.
   */
  menuPath: string;
  /**
   * Display text only, as it is for the built-in items: the accelerators are bound by hand in
   * `MenuBar`'s keydown handler, and a contributed one would need a combination parser and a
   * clash check against those before it could be more than a label.
   */
  shortcut?: string;
}

export const FALLBACK_TOOL = 'navigate';
export const FALLBACK_COLOR_SCHEME = 'element';

export class PluginRegistry {
  private readonly toolList: ToolContribution[] = [];
  private readonly layerList: LayerContribution[] = [];
  private readonly panelList: PanelContribution[] = [];
  private readonly menuList: MenuContribution[] = [];
  private readonly colorList: ColorContribution[] = [];

  registerTool(contribution: ToolContribution): void {
    if (this.toolList.some((c) => c.tool.id === contribution.tool.id)) {
      throw new Error(`tool ${contribution.tool.id} is already registered`);
    }
    const clash = this.toolList.find((c) => c.tool.shortcut === contribution.tool.shortcut);
    if (clash) {
      throw new Error(
        `tool ${contribution.tool.id} wants the shortcut ${clash.tool.id} already has`,
      );
    }
    this.toolList.push(contribution);
  }

  /** Contributed tools in registration order, which is toolbar order. */
  tools(): readonly ToolContribution[] {
    return this.toolList;
  }

  tool(id: string): ToolContribution | undefined {
    return this.toolList.find((c) => c.tool.id === id);
  }

  registerLayer(contribution: LayerContribution): void {
    if (this.layerList.some((c) => c.id === contribution.id)) {
      throw new Error(`layer ${contribution.id} is already registered`);
    }
    this.layerList.push(contribution);
  }

  /** Contributed display layers in registration order, which is the order they are added in. */
  layers(): readonly LayerContribution[] {
    return this.layerList;
  }

  registerPanel(contribution: PanelContribution): void {
    if (this.panelList.some((c) => c.id === contribution.id)) {
      throw new Error(`panel ${contribution.id} is already registered`);
    }
    this.panelList.push(contribution);
  }

  /** Contributed dock panels in registration order, which is tab order. */
  panels(): readonly PanelContribution[] {
    return this.panelList;
  }

  registerColorScheme(contribution: ColorContribution): void {
    if (this.colorList.some((c) => c.id === contribution.id)) {
      throw new Error(`colour scheme ${contribution.id} is already registered`);
    }
    this.colorList.push(contribution);
  }

  /** Contributed colour schemes in registration order, which is the order the list shows. */
  colorSchemes(): readonly ColorContribution[] {
    return this.colorList;
  }

  colorScheme(id: string): ColorContribution | undefined {
    return this.colorList.find((c) => c.id === id);
  }

  registerMenuItem(contribution: MenuContribution): void {
    if (contribution.menuPath.includes('/')) {
      throw new Error(`menu path ${contribution.menuPath} has more than one level`);
    }
    if (this.menuList.some((c) => c.id === contribution.id)) {
      throw new Error(`menu item ${contribution.id} is already registered`);
    }
    this.menuList.push(contribution);
  }

  /** Contributed items of one menu, in registration order. */
  menuItems(menuPath: string): readonly MenuContribution[] {
    return this.menuList.filter((c) => c.menuPath === menuPath);
  }

  /**
   * Every contribution as a row of the Plugin Manager, in kind order and then registration order
   * (Avogadro's list is per type too, `pluginsettings.cpp`). Nothing here is filtered by whether
   * it is switched on: the manager is what switches them, so it needs to see them all.
   */
  items(): PluginItem[] {
    return [
      ...this.toolList.map(({ tool }) => ({
        kind: 'tool' as const,
        id: tool.id,
        name: tool.label,
        description: tool.description,
        // the tool every unknown id falls back to; without it the toolbar has nothing to select
        removable: tool.id !== FALLBACK_TOOL,
      })),
      ...this.layerList.map((c) => ({
        kind: 'layer' as const,
        id: c.id,
        name: c.name,
        description: c.description,
        removable: true,
      })),
      ...this.panelList.map((c) => ({
        kind: 'panel' as const,
        id: c.id,
        name: c.label,
        description: c.description,
        removable: true,
      })),
      ...this.menuList.map((c) => ({
        kind: 'menu' as const,
        id: c.id,
        name: `${c.menuPath}: ${c.label}`,
        description: c.description,
        removable: true,
      })),
      ...this.colorList.map((c) => ({
        kind: 'color' as const,
        id: c.id,
        name: c.label,
        description: c.description,
        // what every other scheme falls back to when it has nothing to colour by
        removable: c.id !== FALLBACK_COLOR_SCHEME,
      })),
    ];
  }

  /** Menus contributed items ask for that are not in `existing`, in registration order. */
  extraMenus(existing: readonly string[]): string[] {
    const seen = new Set(existing);
    const out: string[] = [];
    for (const item of this.menuList) {
      if (seen.has(item.menuPath)) continue;
      seen.add(item.menuPath);
      out.push(item.menuPath);
    }
    return out;
  }
}
