/**
 * Avogadro's Auto Optimization tool: the force field runs continuously while the tool is active,
 * and atoms can be dragged in the middle of it. The dragged atom is pinned for that round, so the
 * rest of the molecule relaxes around where the user is holding it.
 *
 * The document is *previewed* between rounds and committed once when the run stops, so a minute
 * of optimization is one undo step and Undo restores the geometry it started from.
 */
import { Vector3 } from 'three';
import type { StructureDoc, Vec3 } from '../../model/structure';
import { optimizeStep } from '../autoOptimize';
import { setPositions } from '../edits';
import type { PointerLike, Tool, ToolContext } from '../Tool';

/** Wait between rounds; a round is a network request, so this is not a frame budget. */
export const TICK_MS = 60;

export class AutoOptimizeTool implements Tool {
  readonly id = 'auto-optimize';
  readonly label = 'Auto-optimize';
  readonly icon = '⚛';
  readonly shortcut = 'o';
  readonly description =
    'Runs the force field continuously. Left-drag an atom and the rest of the molecule relaxes around it; the whole run is one undo step.';
  private running = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private changed = false;
  /** The last document this tool previewed, so its own previews do not look like someone else's. */
  private shown: StructureDoc | null = null;
  private drag: { atom: number; at: Vector3 } | null = null;
  private schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) =>
    setTimeout(fn, ms);
  private clear: (id: ReturnType<typeof setTimeout>) => void = (id) => clearTimeout(id);

  /** Test hook: replace the timer. */
  useScheduler(
    schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>,
    clear: (id: ReturnType<typeof setTimeout>) => void,
  ): void {
    this.schedule = schedule;
    this.clear = clear;
  }

  activate(ctx: ToolContext): void {
    this.sync(ctx);
    const unsubscribeTools = ctx.tools.subscribe((s, prev) => {
      if (s.autoOptimize.running !== prev.autoOptimize.running) this.sync(ctx);
    });
    // an undo or redo during a run would be swallowed by the next round: stop instead
    const unsubscribeHistory = ctx.structure.subscribe((s, prev) => {
      const changedUnderneath =
        s.historyRevision !== prev.historyRevision || s.doc.id !== prev.doc.id;
      if (changedUnderneath && this.running) {
        this.shown = null;
        this.changed = false;
        ctx.tools.getState().update('autoOptimize', { running: false });
      }
    });
    this.unsubscribe = () => {
      unsubscribeTools();
      unsubscribeHistory();
    };
  }

  deactivate(ctx: ToolContext): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stop(ctx);
    ctx.tools.getState().update('autoOptimize', { running: false });
  }

  cancelGesture(ctx: ToolContext): void {
    this.drag = null;
    this.stop(ctx, { commit: false });
    ctx.tools.getState().update('autoOptimize', { running: false });
  }

  onPointerDown(e: PointerLike, ctx: ToolContext): void {
    // dragging is only meaningful while the force field runs; otherwise it would leave a preview
    // behind that some later commit would adopt under its own label
    if (e.button !== 0 || !ctx.tools.getState().autoOptimize.running) return;
    const hit = ctx.renderer.pick(e.clientX, e.clientY);
    if (hit?.kind !== 'atom') return;
    const p = ctx.structure.getState().doc.atoms[hit.index]?.position;
    if (!p) return;
    this.drag = { atom: hit.index, at: new Vector3(...p) };
  }

  onPointerMove(e: PointerLike, ctx: ToolContext): void {
    if (!this.drag || e.buttons === 0) return;
    const world = ctx.renderer.unprojectOnPlane(e.clientX, e.clientY, this.drag.at);
    this.drag.at.copy(world);
    this.hold(ctx);
  }

  onPointerUp(): void {
    this.drag = null;
  }

  /** Write the dragged atom back to where the pointer is, over whatever the force field did. */
  private hold(ctx: ToolContext): void {
    if (!this.drag) return;
    const st = ctx.structure.getState();
    const at: Vec3 = [this.drag.at.x, this.drag.at.y, this.drag.at.z];
    const next = setPositions(st.doc, new Map([[this.drag.atom, at]]));
    if (next !== st.doc) this.show(ctx, next);
  }

  /** Preview `next` and remember it, so the next round knows it was this tool that moved things. */
  private show(ctx: ToolContext, next: StructureDoc): void {
    this.changed = true;
    this.shown = next;
    ctx.structure.getState().preview(next);
    ctx.renderer.invalidate();
  }

  private sync(ctx: ToolContext): void {
    if (ctx.tools.getState().autoOptimize.running) this.start(ctx);
    else this.stop(ctx);
  }

  private start(ctx: ToolContext): void {
    if (this.running) return;
    this.running = true;
    this.changed = false;
    ctx.tools.getState().update('autoOptimize', { message: null });
    this.tick(ctx);
  }

  private stop(ctx: ToolContext, { commit = true } = {}): void {
    if (this.timer !== null) this.clear(this.timer);
    this.timer = null;
    if (!this.running) return;
    this.running = false;
    const st = ctx.structure.getState();
    if (commit && this.changed) st.commit('Auto-optimize', st.doc);
    else if (!commit) st.cancelPreview();
    this.changed = false;
    this.shown = null;
    // a round that failed mid-drag would otherwise keep previewing under the pointer
    this.drag = null;
  }

  /** One round. A round that is still in flight is never joined by a second one. */
  private tick(ctx: ToolContext): void {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    const settings = ctx.tools.getState().autoOptimize;
    const before = ctx.structure.getState().doc;
    optimizeStep(before, {
      forceField: settings.forceField,
      algorithm: settings.algorithm,
      steps: settings.steps,
      fixed: this.drag ? [this.drag.atom] : [],
    })
      .then((result) => {
        this.inFlight = false;
        if (!this.running) return;
        this.apply(ctx, before, result.doc);
        ctx.tools.getState().update('autoOptimize', {
          energy: result.energy,
          energyUnit: result.unit,
        });
        this.timer = this.schedule(() => this.tick(ctx), TICK_MS);
      })
      .catch((e: unknown) => {
        this.inFlight = false;
        // a force field that cannot type the molecule fails every round: say so once and stop
        ctx.tools.getState().update('autoOptimize', {
          running: false,
          message: `Auto-optimize stopped: ${(e as Error).message}`,
        });
      });
  }

  private apply(ctx: ToolContext, before: StructureDoc, next: StructureDoc): void {
    const st = ctx.structure.getState();
    // Someone else edited while the round ran: that document wins and this result is stale. The
    // tool's own previews do not count -- dragging replaces the document on every pointer move,
    // and dropping the results then would mean the molecule never relaxes while an atom is held.
    if (st.doc !== before && st.doc !== this.shown) return;
    this.show(ctx, next);
    this.hold(ctx);
  }
}
