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

export type ErrorSink = (message: string) => void;

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
  /**
   * The panel's body, rendered as a component (`<Panel onError={...} />`), so it may use hooks.
   * Panels stay mounted while another tab is open, which is what keeps their form state.
   */
  component: (props: { onError: ErrorSink }) => JSX.Element;
}

export class PluginRegistry {
  private readonly toolList: ToolContribution[] = [];
  private readonly layerList: LayerContribution[] = [];
  private readonly panelList: PanelContribution[] = [];

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
}
