/** Default tool: camera navigation is delegated to the CameraController (enabled by the host). */
import { Vector3 } from 'three';
import type { PointerLike, Tool, ToolContext } from '../Tool';

export class NavigateTool implements Tool {
  readonly id = 'navigate';
  readonly label = 'Navigate';
  readonly icon = '✋';
  readonly shortcut = 'n';
  readonly description =
    'Left-drag rotates about the selection, or about the atom you grab, or about what you are looking at; right/middle-drag pans, wheel zooms. Double-click an atom to center on it.';
  readonly camera = true;
  readonly cursor = 'grab';

  onDoubleClick(e: PointerLike, ctx: ToolContext): void {
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    const atom = hit?.kind === 'atom' ? ctx.structure.getState().doc.atoms[hit.index] : undefined;
    if (atom) ctx.renderer.controller.setPivot(new Vector3(...atom.position));
    else ctx.renderer.fitToStructure();
  }
}
