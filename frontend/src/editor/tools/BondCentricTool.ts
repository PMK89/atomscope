/**
 * Bond-centric manipulation: click a bond to select it, then left-drag changes its length
 * (moving the smaller fragment) and right-drag rotates that fragment about the bond axis.
 */
import { Vector3 } from 'three';
import { sideOfBond } from '../../model/connectivity';
import { distance, sub } from '../../model/geometry';
import type { StructureDoc, Vec3 } from '../../model/structure';
import { rotateAtoms, setBondLength } from '../edits';
import { DRAG_THRESHOLD_PX } from '../Tool';
import type { OverlayShape, PointerLike, Tool, ToolContext } from '../Tool';

const ROTATE_RAD_PER_PX = 0.01;

/** The side of `bond` that should move: the smaller fragment (ties move atom `b`). */
export function movingSide(doc: StructureDoc, bond: number): { atoms: Set<number>; end: number } {
  const b = doc.bonds[bond]!;
  const sideA = sideOfBond(doc, bond, b.a);
  const sideB = sideOfBond(doc, bond, b.b);
  return sideA.size < sideB.size ? { atoms: sideA, end: b.a } : { atoms: sideB, end: b.b };
}

export function bondLength(doc: StructureDoc, bond: number): number | null {
  const b = doc.bonds[bond];
  const pa = b && doc.atoms[b.a]?.position;
  const pb = b && doc.atoms[b.b]?.position;
  return pa && pb ? distance(pa, pb) : null;
}

export class BondCentricTool implements Tool {
  readonly id = 'bond-centric';
  readonly label = 'Bond-centric';
  readonly icon = '⟷';
  readonly shortcut = 'b';
  readonly description =
    'Click a bond to select it. Left-drag changes the bond length (moving the smaller fragment), right-drag rotates that fragment about the bond.';
  private base: StructureDoc | null = null;
  private start: { x: number; y: number } | null = null;
  private mode: 'length' | 'twist' = 'length';
  private moved = false;
  private clickedEmpty = false;
  private startLength = 0;
  private axis2d: [number, number] = [1, 0];

  onPointerDown(e: PointerLike, ctx: ToolContext): void {
    if (e.button !== 0 && e.button !== 2) return;
    const doc = ctx.structure.getState().doc;
    const tools = ctx.tools.getState();
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    if (hit?.kind === 'bond') tools.update('bondCentric', { bond: hit.index });
    this.clickedEmpty = !hit;
    const bond = ctx.tools.getState().bondCentric.bond;
    if (bond === null || !doc.bonds[bond]) return;
    this.base = doc;
    this.start = { x: e.clientX, y: e.clientY };
    this.mode = e.button === 2 ? 'twist' : 'length';
    this.moved = false;
    this.startLength = bondLength(doc, bond) ?? 0;
    // screen direction along which dragging lengthens the bond (towards the moving end)
    const b = doc.bonds[bond]!;
    const { end } = movingSide(doc, bond);
    const other = end === b.a ? b.b : b.a;
    const pFixed = ctx.renderer.project(new Vector3(...doc.atoms[other]!.position));
    const pMoving = ctx.renderer.project(new Vector3(...doc.atoms[end]!.position));
    const len = Math.hypot(pMoving.x - pFixed.x, pMoving.y - pFixed.y) || 1;
    this.axis2d = [(pMoving.x - pFixed.x) / len, (pMoving.y - pFixed.y) / len];
  }

  onPointerMove(e: PointerLike, ctx: ToolContext): void {
    if (!this.base || !this.start || e.buttons === 0) return;
    const bond = ctx.tools.getState().bondCentric.bond;
    if (bond === null) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    if (!this.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.moved = true;
    const { atoms, end } = movingSide(this.base, bond);
    let next: StructureDoc;
    if (this.mode === 'length') {
      const along = dx * this.axis2d[0] + dy * this.axis2d[1];
      const target = Math.max(
        0.3,
        this.startLength + along * ctx.renderer.controller.worldPerPixel(),
      );
      next = setBondLength(this.base, bond, target, atoms);
    } else {
      const b = this.base.bonds[bond]!;
      const other = end === b.a ? b.b : b.a;
      const pOther = this.base.atoms[other]!.position;
      const axis: Vec3 = sub(this.base.atoms[end]!.position, pOther);
      next = rotateAtoms(this.base, atoms, axis, dx * ROTATE_RAD_PER_PX, pOther);
    }
    ctx.structure.getState().preview(next);
  }

  onPointerUp(e: PointerLike, ctx: ToolContext): void {
    const st = ctx.structure.getState();
    if (this.moved) {
      st.commit(this.mode === 'length' ? 'Change bond length' : 'Rotate about bond', st.doc);
    } else {
      if (this.base) st.cancelPreview();
      // a plain click in empty space deselects the bond
      if (e.button === 0 && this.clickedEmpty) {
        ctx.tools.getState().update('bondCentric', { bond: null });
      }
    }
    this.clickedEmpty = false;
    this.base = null;
    this.start = null;
  }

  overlay(ctx: ToolContext): OverlayShape[] {
    const doc = ctx.structure.getState().doc;
    const bond = ctx.tools.getState().bondCentric.bond;
    if (bond === null) return [];
    const b = doc.bonds[bond];
    const len = bondLength(doc, bond);
    if (!b || len === null) return [];
    const pa = doc.atoms[b.a]!.position;
    const pb = doc.atoms[b.b]!.position;
    const mid = ctx.renderer.project(
      new Vector3((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2),
    );
    const a = ctx.renderer.project(new Vector3(...pa));
    const c = ctx.renderer.project(new Vector3(...pb));
    return [
      { kind: 'line', x1: a.x, y1: a.y, x2: c.x, y2: c.y },
      { kind: 'label', x: mid.x, y: mid.y, text: `${len.toFixed(3)} Å` },
    ];
  }
}
