/** Drag atoms in the camera plane (Shift: along the view axis); right-drag rotates the selection. */
import { Vector3 } from 'three';
import type { StructureDoc, Vec3 } from '../../model/structure';
import { centroid } from '../../model/structure';
import { rotateAtoms, translateAtoms } from '../edits';
import { DRAG_THRESHOLD_PX } from '../Tool';
import type { PointerLike, Tool, ToolContext } from '../Tool';

const ROTATE_RAD_PER_PX = 0.01;

export class ManipulateTool implements Tool {
  readonly id = 'manipulate';
  readonly label = 'Manipulate';
  readonly icon = '✥';
  readonly shortcut = 'm';
  readonly description =
    'Left-drag moves the selection (or the atom under the cursor) in the view plane, Shift moves along the view axis, right-drag rotates about the centroid.';
  private base: StructureDoc | null = null;
  private atoms: number[] = [];
  private mode: 'translate' | 'rotate' = 'translate';
  private start: { x: number; y: number } | null = null;
  private ref = new Vector3();
  private moved = false;

  /** Atoms affected by a gesture starting on `hit`: the selection, or the single picked atom. */
  static targets(selected: ReadonlySet<number>, hit: number | null): number[] {
    if (hit !== null && !selected.has(hit)) return [hit];
    if (selected.size > 0) return [...selected];
    return hit !== null ? [hit] : [];
  }

  onPointerDown(e: PointerLike, ctx: ToolContext): void {
    if (e.button !== 0 && e.button !== 2) return;
    const doc = ctx.structure.getState().doc;
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    this.atoms = ManipulateTool.targets(
      ctx.selection.getState().atoms,
      hit?.kind === 'atom' ? hit.index : null,
    );
    if (this.atoms.length === 0) return;
    this.base = doc;
    this.mode = e.button === 2 ? 'rotate' : 'translate';
    this.start = { x: e.clientX, y: e.clientY };
    this.ref.set(...centroid(doc, this.atoms));
    this.moved = false;
  }

  cancelGesture(): void {
    this.base = null;
    this.start = null;
    this.atoms = [];
    this.moved = false;
  }

  onPointerMove(e: PointerLike, ctx: ToolContext): void {
    if (!this.base || !this.start || e.buttons === 0) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    if (!this.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.moved = true;
    const { renderer } = ctx;
    let next: StructureDoc;
    if (this.mode === 'translate') {
      let delta: Vec3;
      if (e.shiftKey) {
        const view = renderer.controller.viewDirection(new Vector3());
        const d = view.multiplyScalar(-dy * renderer.controller.worldPerPixel());
        delta = [d.x, d.y, d.z];
      } else {
        const p0 = renderer.unprojectOnPlane(this.start.x, this.start.y, this.ref);
        const p1 = renderer.unprojectOnPlane(e.clientX, e.clientY, this.ref);
        delta = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
      }
      next = translateAtoms(this.base, this.atoms, delta);
    } else {
      const { right, up } = renderer.controller.axes();
      const o: Vec3 = [this.ref.x, this.ref.y, this.ref.z];
      next = rotateAtoms(this.base, this.atoms, [up.x, up.y, up.z], dx * ROTATE_RAD_PER_PX, o);
      next = rotateAtoms(next, this.atoms, [right.x, right.y, right.z], dy * ROTATE_RAD_PER_PX, o);
    }
    ctx.structure.getState().preview(next);
  }

  onPointerUp(_e: PointerLike, ctx: ToolContext): void {
    if (!this.base) return;
    const st = ctx.structure.getState();
    if (this.moved) {
      const n = this.atoms.length;
      const what = n === 1 ? '1 atom' : `${n} atoms`;
      st.commit(this.mode === 'translate' ? `Move ${what}` : `Rotate ${what}`, st.doc);
    } else st.cancelPreview();
    this.base = null;
    this.start = null;
    this.atoms = [];
  }
}
