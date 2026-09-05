/**
 * Avogadro-style draw tool: click adds an atom (or changes an element / cycles a bond order),
 * dragging from an atom grows a bonded atom or bonds to an existing one, right-click deletes.
 */
import { Vector3 } from 'three';
import { elementBySymbol } from '../../model/elements';
import type { StructureDoc, Vec3 } from '../../model/structure';
import {
  addAtom,
  addBond,
  bondedPosition,
  cycleBondOrder,
  remapAfterRemoval,
  removeAtoms,
  removeBond,
  setElement,
} from '../edits';
import { adjustHydrogens, hydrogenNeighbors } from '../valence';
import { DRAG_THRESHOLD_PX } from '../Tool';
import type { KeyLike, PointerLike, Tool, ToolContext } from '../Tool';

const radiusOf = (el: string): number => elementBySymbol(el).covalentRadius;

/** Adjust hydrogens on several atoms, tracking them by uid since indices shift. */
export function adjustMany(doc: StructureDoc, uids: Iterable<string | undefined>): StructureDoc {
  let out = doc;
  for (const uid of uids) {
    if (!uid) continue;
    const idx = out.atoms.findIndex((a) => a.uid === uid);
    if (idx >= 0) out = adjustHydrogens(out, idx);
  }
  return out;
}

export class DrawTool implements Tool {
  readonly id = 'draw';
  readonly label = 'Draw';
  readonly icon = '✎';
  readonly shortcut = 'd';
  readonly description =
    'Click adds an atom or changes an element, click a bond to cycle its order, drag from an atom to grow a bonded atom, right-click deletes. Keys 1/2/3 set the bond order.';
  private base: StructureDoc | null = null;
  private startAtom: number | null = null;
  private startedOnBond: number | null = null;
  private startClient: { x: number; y: number } | null = null;
  private dragging = false;
  /** Index of the atom created on pointer-down in empty space (part of `base`). */
  private createdOnDown = false;
  /** Preview state of the current drag, committed on pointer-up. */
  private previewDoc: StructureDoc | null = null;
  private previewTarget: number | null = null;

  onPointerDown(e: PointerLike, ctx: ToolContext): void {
    const st = ctx.structure.getState();
    const doc = st.doc;
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    if (e.button === 2) {
      if (hit) this.delete(hit.kind, hit.index, ctx);
      return;
    }
    if (e.button !== 0) return;
    this.startClient = { x: e.clientX, y: e.clientY };
    this.dragging = false;
    this.previewDoc = null;
    this.previewTarget = null;
    this.startedOnBond = hit?.kind === 'bond' ? hit.index : null;
    this.createdOnDown = false;
    if (hit?.kind === 'atom') {
      this.base = doc;
      this.startAtom = hit.index;
    } else if (!hit) {
      const p = ctx.renderer.unprojectOnPivotPlane(e.clientX, e.clientY);
      const { element } = ctx.tools.getState().draw;
      const added = addAtom(doc, element, [p.x, p.y, p.z], true);
      this.base = added.doc;
      this.startAtom = added.index;
      this.createdOnDown = true;
      st.preview(this.base);
    } else {
      this.base = doc;
      this.startAtom = null;
    }
  }

  onPointerMove(e: PointerLike, ctx: ToolContext): void {
    if (!this.base || this.startAtom === null || !this.startClient || !(e.buttons & 1)) return;
    if (
      !this.dragging &&
      Math.hypot(e.clientX - this.startClient.x, e.clientY - this.startClient.y) < DRAG_THRESHOLD_PX
    )
      return;
    this.dragging = true;
    const { element, bondOrder } = ctx.tools.getState().draw;
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    const previewAtom = this.base.atoms.length; // index the grown atom would get
    const start = this.startAtom;
    if (hit?.kind === 'atom' && hit.index !== start && hit.index < previewAtom) {
      this.previewDoc = addBond(this.base, start, hit.index, bondOrder);
      this.previewTarget = hit.index;
    } else {
      const from = this.base.atoms[start]!;
      const towards = ctx.renderer.unprojectOnPlane(
        e.clientX,
        e.clientY,
        new Vector3(...from.position),
      );
      const pos: Vec3 = bondedPosition(
        this.base,
        start,
        [towards.x, towards.y, towards.z],
        element,
        radiusOf,
      );
      const grown = addAtom(this.base, element, pos);
      this.previewDoc = addBond(grown.doc, start, grown.index, bondOrder);
      this.previewTarget = grown.index;
    }
    ctx.structure.getState().preview(this.previewDoc);
  }

  onPointerUp(e: PointerLike, ctx: ToolContext): void {
    if (e.button !== 0 || !this.base) return;
    const st = ctx.structure.getState();
    const { element, adjustHydrogens: adjust } = ctx.tools.getState().draw;
    const start = this.startAtom;
    let next: StructureDoc;
    let label: string;
    if (this.dragging && this.previewDoc && start !== null && this.previewTarget !== null) {
      next = this.previewDoc;
      const touched = [next.atoms[start]?.uid, next.atoms[this.previewTarget]?.uid];
      if (adjust) next = adjustMany(next, touched);
      label = this.previewTarget < this.base.atoms.length ? 'Add bond' : `Add ${element}`;
    } else if (this.createdOnDown && start !== null) {
      next = adjust ? adjustHydrogens(this.base, start) : this.base;
      label = `Add ${element}`;
    } else if (this.startedOnBond !== null) {
      const bond = this.base.bonds[this.startedOnBond];
      next = cycleBondOrder(this.base, this.startedOnBond);
      if (adjust && bond)
        next = adjustMany(next, [next.atoms[bond.a]?.uid, next.atoms[bond.b]?.uid]);
      label = 'Change bond order';
    } else if (start !== null && this.base.atoms[start]?.element !== element) {
      next = setElement(this.base, start, element);
      if (adjust) next = adjustHydrogens(next, start);
      label = `Change to ${element}`;
    } else {
      st.cancelPreview();
      this.reset();
      return;
    }
    st.commit(label, next);
    this.reset();
  }

  onKeyDown(e: KeyLike, ctx: ToolContext): boolean {
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      ctx.tools.getState().update('draw', { bondOrder: Number(e.key) as 1 | 2 | 3 });
      return true;
    }
    return false;
  }

  private delete(kind: 'atom' | 'bond', index: number, ctx: ToolContext): void {
    const st = ctx.structure.getState();
    const sel = ctx.selection.getState();
    const doc = st.doc;
    const adjust = ctx.tools.getState().draw.adjustHydrogens;
    if (kind === 'atom') {
      const gone = new Set([index, ...(adjust ? hydrogenNeighbors(doc, index) : [])]);
      const neighbors = doc.bonds
        .filter((b) => b.a === index || b.b === index)
        .map((b) => (b.a === index ? b.b : b.a))
        .filter((j) => !gone.has(j))
        .map((j) => doc.atoms[j]?.uid);
      let next = removeAtoms(doc, gone);
      if (adjust) next = adjustMany(next, neighbors);
      sel.set(remapAfterRemoval(gone, sel.atoms));
      st.commit(gone.size > 1 ? `Delete ${gone.size} atoms` : 'Delete atom', next);
    } else {
      const bond = doc.bonds[index];
      if (!bond) return;
      let next = removeBond(doc, index);
      if (adjust) next = adjustMany(next, [doc.atoms[bond.a]?.uid, doc.atoms[bond.b]?.uid]);
      st.commit('Delete bond', next);
    }
  }

  private reset(): void {
    this.base = null;
    this.startAtom = null;
    this.startedOnBond = null;
    this.startClient = null;
    this.dragging = false;
    this.createdOnDown = false;
    this.previewDoc = null;
    this.previewTarget = null;
  }
}
