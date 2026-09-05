/**
 * Click / rubber-band / double-click selection with atom-and-bond, residue or molecule
 * granularity (Avogadro's Selection Mode combo: Atom/Bond, Residue, Molecule).
 */
import { Vector3 } from 'three';
import { fragmentOf } from '../../model/connectivity';
import { atomsInRect, bondsWithin, combineSelection, expandSelection } from '../selectionMath';
import { DRAG_THRESHOLD_PX, pointerModifier } from '../Tool';
import type { OverlayShape, PointerLike, Tool, ToolContext } from '../Tool';

export class SelectTool implements Tool {
  readonly id = 'select';
  readonly label = 'Select';
  readonly icon = '⬚';
  readonly shortcut = 's';
  readonly description =
    'Click selects, Shift adds, Ctrl toggles, drag selects a rectangle, double-click selects the fragment, right-click clears.';
  private start: { x: number; y: number } | null = null;
  private dragging = false;

  onPointerDown(e: PointerLike, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.start = ctx.renderer.toCanvasCoords(e.clientX, e.clientY);
    this.dragging = false;
  }

  cancelGesture(ctx: ToolContext): void {
    this.start = null;
    this.dragging = false;
    ctx.tools.getState().update('select', { rect: null });
  }

  onPointerMove(e: PointerLike, ctx: ToolContext): void {
    if (!this.start || !(e.buttons & 1)) return;
    const p = ctx.renderer.toCanvasCoords(e.clientX, e.clientY);
    if (!this.dragging && Math.hypot(p.x - this.start.x, p.y - this.start.y) < DRAG_THRESHOLD_PX)
      return;
    this.dragging = true;
    ctx.tools.getState().update('select', {
      rect: { x0: this.start.x, y0: this.start.y, x1: p.x, y1: p.y },
    });
  }

  onPointerUp(e: PointerLike, ctx: ToolContext): void {
    const sel = ctx.selection.getState();
    if (e.button === 2) {
      if (ctx.renderer.pick(e.clientX, e.clientY) === null) sel.clear();
      return;
    }
    if (e.button !== 0 || !this.start) return;
    const doc = ctx.structure.getState().doc;
    const mode = ctx.tools.getState().select.mode;
    const modifier = pointerModifier(e);
    let picked: number[];
    // a bond clicked in Atom/Bond mode is a primitive of its own, as it is in Avogadro; under
    // residue or molecule granularity it stands for the atoms it joins, like any other hit
    let pickedBonds: number[] = [];
    if (this.dragging) {
      const rect = ctx.tools.getState().select.rect;
      ctx.tools.getState().update('select', { rect: null });
      if (!rect) return;
      const projected = doc.atoms.map((a) => ctx.renderer.project(new Vector3(...a.position)));
      picked = atomsInRect(rect, projected);
      pickedBonds = bondsWithin(doc, new Set(picked));
    } else {
      const hit = ctx.renderer.pick(e.clientX, e.clientY);
      if (!hit) {
        if (modifier === 'replace') sel.clear();
        this.start = null;
        return;
      }
      const bond = hit.kind === 'bond' ? doc.bonds[hit.index] : undefined;
      if (hit.kind === 'atom') picked = [hit.index];
      else if (!bond) picked = [];
      else if (mode === 'atoms') {
        picked = [];
        pickedBonds = [hit.index];
      } else picked = [bond.a, bond.b];
    }
    this.start = null;
    const expanded = expandSelection(doc, picked, mode);
    const atoms = combineSelection(sel.atoms, expanded, modifier);
    // the bonds a selection implies: those with both ends in it, plus one picked on its own
    sel.set(atoms, mode === 'atoms' ? combineSelection(sel.bonds, pickedBonds, modifier) : []);
  }

  onDoubleClick(e: PointerLike, ctx: ToolContext): void {
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    if (hit?.kind !== 'atom') return;
    const doc = ctx.structure.getState().doc;
    ctx.selection.getState().set(fragmentOf(doc, hit.index));
  }

  overlay(ctx: ToolContext): OverlayShape[] {
    const r = ctx.tools.getState().select.rect;
    if (!r) return [];
    return [
      {
        kind: 'rect',
        x: Math.min(r.x0, r.x1),
        y: Math.min(r.y0, r.y1),
        w: Math.abs(r.x1 - r.x0),
        h: Math.abs(r.y1 - r.y0),
      },
    ];
  }
}
