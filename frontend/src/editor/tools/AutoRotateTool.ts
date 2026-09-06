/** Continuous rotation about the x/y/z view axes; any pointer interaction stops it. */
import type { Tool, ToolContext } from '../Tool';

export class AutoRotateTool implements Tool {
  readonly id = 'auto-rotate';
  readonly label = 'Auto-rotate';
  readonly icon = '↻';
  readonly shortcut = 'a';
  readonly description =
    'Spins the view at the configured speeds (degrees per second). Click in the view to stop.';
  readonly camera = true;
  private frame: number | null = null;
  private lastTime = 0;
  private unsubscribe: (() => void) | null = null;
  private raf: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb);
  private cancel: (id: number) => void = (id) => cancelAnimationFrame(id);

  /** Test hook: replace the animation-frame scheduler. */
  useScheduler(raf: (cb: (t: number) => void) => number, cancel: (id: number) => void): void {
    this.raf = raf;
    this.cancel = cancel;
  }

  activate(ctx: ToolContext): void {
    this.sync(ctx);
    this.unsubscribe = ctx.tools.subscribe((s, prev) => {
      if (s.autoRotate.running !== prev.autoRotate.running) this.sync(ctx);
    });
  }

  deactivate(ctx: ToolContext): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stop();
    ctx.renderer.controller.resetRoll();
    ctx.tools.getState().update('autoRotate', { running: false });
  }

  onPointerDown(_e: unknown, ctx: ToolContext): void {
    ctx.tools.getState().update('autoRotate', { running: false });
  }

  /** Advance the rotation by `dtSeconds` using the current speeds. */
  step(ctx: ToolContext, dtSeconds: number): void {
    const { x, y, z } = ctx.tools.getState().autoRotate;
    const rad = Math.PI / 180;
    const cam = ctx.renderer.controller;
    if (x || y) cam.rotateBy(y * rad * dtSeconds, x * rad * dtSeconds);
    if (z) cam.roll(z * rad * dtSeconds);
  }

  private sync(ctx: ToolContext): void {
    if (ctx.tools.getState().autoRotate.running) this.start(ctx);
    else this.stop();
  }

  private start(ctx: ToolContext): void {
    if (this.frame !== null) return;
    this.lastTime = 0;
    const tick = (t: number): void => {
      if (this.lastTime) this.step(ctx, Math.min(0.1, (t - this.lastTime) / 1000));
      this.lastTime = t;
      this.frame = this.raf(tick);
    };
    this.frame = this.raf(tick);
  }

  private stop(): void {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
  }
}
