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

export class PluginRegistry {
  private readonly toolList: ToolContribution[] = [];

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
}
