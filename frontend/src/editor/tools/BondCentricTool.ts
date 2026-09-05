/**
 * Bond-centric manipulation: click a bond to select it, then left-drag changes its length
 * (moving the smaller fragment) and right-drag rotates that fragment about the bond axis.
 *
 * Dragging an *atom* that hangs off one end of the selected bond changes the angle it makes with
 * the bond, which is Avogadro's third gesture (bondcentrictool.cpp:661-700, where it turns the
 * clicked atom about the screen normal through the bond end). It drives the same `setAngle` the
 * Properties tab's angle table types into, so a dragged angle and a typed one are one edit.
 */
import { Vector3 } from 'three';
import { bondsOfAtom, findBond, fragmentOf, sideOfBond } from '../../model/connectivity';
import { angleDeg, cross, distance, normalize, scale, sub } from '../../model/geometry';
import type { StructureDoc, Vec3 } from '../../model/structure';
import { rotateAtoms, setAngle, setBondLength } from '../edits';
import { DRAG_THRESHOLD_PX } from '../Tool';
import type { OverlayShape, PointerLike, Tool, ToolContext } from '../Tool';

const ROTATE_RAD_PER_PX = 0.01;
const ANGLE_DEG_PER_PX = 0.5;
/** How far along the tangent to step when working out which way the atom moves on screen. */
const PROBE = 0.05;

/** The angle a—b—c a dragged atom drives: `atom` hangs off end `b` of `bond`, whose far end is c. */
export interface AngleGrab {
  atom: number;
  vertex: number;
  far: number;
  /** the atoms that turn with `atom`; null when it sits in a ring and nothing can turn */
  moving: number[] | null;
}

/**
 * The angle `atom` would drive, or null when it is not attached to exactly one end of `bond`.
 * An atom of the bond itself drives nothing: it *is* the bond.
 */
export function angleGrab(doc: StructureDoc, bond: number, atom: number): AngleGrab | null {
  const b = doc.bonds[bond];
  if (!b || atom === b.a || atom === b.b) return null;
  const neighbours = bondsOfAtom(doc, atom).map((i) => {
    const nb = doc.bonds[i]!;
    return nb.a === atom ? nb.b : nb.a;
  });
  const onA = neighbours.includes(b.a);
  const onB = neighbours.includes(b.b);
  if (onA === onB) return null; // attached to both ends (a three-ring) or to neither
  const vertex = onA ? b.a : b.b;
  const far = onA ? b.b : b.a;
  const link = findBond(doc, atom, vertex);
  const side = link < 0 ? null : fragmentOf(doc, atom, link);
  // turning one side of a ring about the vertex would tear it open, as the angle table says
  const moving = side && !side.has(vertex) ? [...side] : null;
  return { atom, vertex, far, moving };
}

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
    'Click a bond to select it. Left-drag changes the bond length (moving the smaller fragment), right-drag rotates that fragment about the bond, and left-dragging an atom next to the bond changes the angle it makes with it.';
  private base: StructureDoc | null = null;
  private start: { x: number; y: number } | null = null;
  private mode: 'length' | 'twist' | 'angle' = 'length';
  private moved = false;
  private clickedEmpty = false;
  private startLength = 0;
  private axis2d: [number, number] = [1, 0];
  private grab: AngleGrab | null = null;
  private startAngle = 0;

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
    this.moved = false;
    this.grab = hit?.kind === 'atom' ? angleGrab(doc, bond, hit.index) : null;
    this.mode = e.button === 2 ? 'twist' : this.grab ? 'angle' : 'length';
    if (this.mode === 'angle' && this.grab) {
      const { atom, vertex, far } = this.grab;
      this.startAngle = angleDeg(
        doc.atoms[atom]!.position,
        doc.atoms[vertex]!.position,
        doc.atoms[far]!.position,
      );
      this.axis2d = this.angleDirection(doc, this.grab, ctx);
      return;
    }
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

  /**
   * The screen direction in which the grabbed atom moves as the angle opens: the atom stepped a
   * little along the tangent of its turn, projected. Reading it once, at pointer-down, keeps the
   * gesture stable while the drag is under way, exactly as the length drag does.
   */
  private angleDirection(doc: StructureDoc, grab: AngleGrab, ctx: ToolContext): [number, number] {
    const pAtom = doc.atoms[grab.atom]!.position;
    const pVertex = doc.atoms[grab.vertex]!.position;
    const arm = sub(pAtom, pVertex);
    // the axis setAngle turns about with the grabbed atom as its `c`: (a - b) x (c - b)
    const normal = cross(sub(doc.atoms[grab.far]!.position, pVertex), arm);
    const tangent = cross(normal, arm);
    if (Math.hypot(...tangent) < 1e-9) return [1, 0]; // three atoms in a line: no plane to turn in
    const stepped = scale(normalize(tangent), PROBE);
    const here = ctx.renderer.project(new Vector3(...pAtom));
    const there = ctx.renderer.project(
      new Vector3(pAtom[0] + stepped[0], pAtom[1] + stepped[1], pAtom[2] + stepped[2]),
    );
    const dx = there.x - here.x;
    const dy = there.y - here.y;
    const len = Math.hypot(dx, dy);
    // edge-on: the turn barely moves the atom on screen, so fall back to a horizontal drag
    return len < 1e-6 ? [1, 0] : [dx / len, dy / len];
  }

  onPointerMove(e: PointerLike, ctx: ToolContext): void {
    if (!this.base || !this.start || e.buttons === 0) return;
    const bond = ctx.tools.getState().bondCentric.bond;
    if (bond === null) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    if (!this.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.moved = true;
    if (this.mode === 'angle') {
      const grab = this.grab;
      if (!grab?.moving) return; // in a ring: turning one side would tear it open
      const along = dx * this.axis2d[0] + dy * this.axis2d[1];
      const target = this.startAngle + along * ANGLE_DEG_PER_PX;
      // the grabbed atom is setAngle's `c`: it turns the side of `c`, and handing it the `a` side
      // would move the atom the other way by the same amount
      ctx.structure
        .getState()
        .preview(setAngle(this.base, grab.far, grab.vertex, grab.atom, target, grab.moving));
      return;
    }
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
      const label =
        this.mode === 'length'
          ? 'Change bond length'
          : this.mode === 'twist'
            ? 'Rotate about bond'
            : 'Change bond angle';
      st.commit(label, st.doc);
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
    this.grab = null;
  }

  cancelGesture(): void {
    this.base = null;
    this.start = null;
    this.moved = false;
    this.clickedEmpty = false;
    this.grab = null;
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
    const shapes: OverlayShape[] = [
      { kind: 'line', x1: a.x, y1: a.y, x2: c.x, y2: c.y },
      { kind: 'label', x: mid.x, y: mid.y, text: `${len.toFixed(3)} Å` },
    ];
    const grab = this.grab;
    if (grab) {
      const p = ctx.renderer.project(new Vector3(...doc.atoms[grab.atom]!.position));
      const value = angleDeg(
        doc.atoms[grab.atom]!.position,
        doc.atoms[grab.vertex]!.position,
        doc.atoms[grab.far]!.position,
      );
      shapes.push({
        kind: 'label',
        x: p.x + 6,
        y: p.y - 6,
        // a ring has no side to turn, and saying so beats a drag that does nothing
        text: grab.moving ? `${value.toFixed(1)}°` : 'angle in a ring',
      });
    }
    return shapes;
  }
}
