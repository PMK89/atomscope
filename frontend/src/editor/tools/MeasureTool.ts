/** Click up to four atoms to measure distances, the angle and the dihedral. Right-click resets. */
import { Vector3 } from 'three';
import { measure } from '../measure';
import type { OverlayShape, PointerLike, Tool, ToolContext } from '../Tool';

export class MeasureTool implements Tool {
  readonly id = 'measure';
  readonly label = 'Measure';
  readonly icon = '📏';
  readonly shortcut = 'r';
  readonly description =
    'Click up to four atoms: two give a distance, three an angle, four a dihedral. Click a marked atom to unmark it; right-click resets.';
  private start: { x: number; y: number } | null = null;

  onPointerDown(e: PointerLike): void {
    this.start = { x: e.clientX, y: e.clientY };
  }

  onPointerUp(e: PointerLike, ctx: ToolContext): void {
    const tools = ctx.tools.getState();
    if (e.button === 2) {
      tools.update('measure', { atoms: [] });
      return;
    }
    if (e.button !== 0 || !this.start) return;
    const moved = Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > 3;
    this.start = null;
    if (moved) return;
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    if (hit?.kind !== 'atom') return;
    const picks = tools.measure.atoms;
    if (picks.includes(hit.index)) {
      tools.update('measure', { atoms: picks.filter((i) => i !== hit.index) });
    } else if (picks.length >= 4) {
      tools.update('measure', { atoms: [hit.index] });
    } else {
      tools.update('measure', { atoms: [...picks, hit.index] });
    }
  }

  overlay(ctx: ToolContext): OverlayShape[] {
    const doc = ctx.structure.getState().doc;
    const picks = ctx.tools.getState().measure.atoms.filter((i) => i < doc.atoms.length);
    const pts = picks.map((i) => ctx.renderer.project(new Vector3(...doc.atoms[i]!.position)));
    const shapes: OverlayShape[] = [];
    const m = measure(doc, picks);
    pts.forEach((p, k) => {
      if (k > 0) {
        const q = pts[k - 1]!;
        shapes.push({ kind: 'line', x1: q.x, y1: q.y, x2: p.x, y2: p.y });
        const d = m?.distances[k - 1];
        if (d !== undefined) {
          shapes.push({
            kind: 'label',
            x: (p.x + q.x) / 2 + 6,
            y: (p.y + q.y) / 2 - 6,
            text: `${d.toFixed(3)} Å`,
          });
        }
      }
      shapes.push({ kind: 'marker', x: p.x, y: p.y, text: `*${k + 1}` });
    });
    const vertex = pts[1];
    if (m && vertex) {
      const parts: string[] = [];
      if (m.angle !== null) parts.push(`${m.angle.toFixed(2)}°`);
      if (m.dihedral !== null) parts.push(`dihedral ${m.dihedral.toFixed(2)}°`);
      if (parts.length) {
        shapes.push({ kind: 'label', x: vertex.x + 10, y: vertex.y + 18, text: parts.join('  ') });
      }
    }
    return shapes;
  }
}
