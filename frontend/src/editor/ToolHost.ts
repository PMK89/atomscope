/**
 * Binds the active tool to the canvas: pointer capture, hover highlighting, keyboard shortcuts
 * and tool activation/deactivation. Dispatch methods are public so tests can drive tools with
 * plain objects instead of DOM events.
 */
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import type {
  KeyLike,
  PointerLike,
  Tool,
  ToolContext,
  ToolId,
  ToolRenderer,
  WheelLike,
} from './Tool';
import { useToolStore } from './toolStore';

const CAMERA_TOOLS: ReadonlySet<ToolId> = new Set(['navigate', 'auto-rotate']);
/** Pointer travel below this (CSS pixels) does not trigger another hover pick. */
const HOVER_MIN_MOVE_PX = 2;

export class ToolHost {
  readonly ctx: ToolContext;
  private active: Tool;
  private readonly unsubscribe: (() => void)[] = [];
  private dragging = false;
  /** True between an aborted gesture and its pointer-up: further events of that drag are dropped. */
  private gestureAborted = false;
  /** Throttling state of hover picking: pending pointer position, frame handle, last pick. */
  private pendingHover: { x: number; y: number } | null = null;
  private hoverFrame: number | null = null;
  private lastHoverPick: { x: number; y: number } | null = null;

  constructor(
    renderer: ToolRenderer,
    private readonly tools: readonly Tool[],
    element: HTMLElement | null = null,
  ) {
    this.ctx = {
      renderer,
      structure: useStructureStore,
      selection: useSelectionStore,
      tools: useToolStore,
      setCursor: (c) => {
        if (element) element.style.cursor = c;
      },
    };
    this.active = this.toolById(useToolStore.getState().active);
    this.enter(this.active);
    this.unsubscribe.push(
      useToolStore.subscribe((s, prev) => {
        if (s.active !== prev.active) this.switchTo(s.active);
      }),
      useStructureStore.subscribe((s, prev) => {
        // a different document invalidates every stored atom/bond index
        if (s.doc.id !== prev.doc.id) {
          useToolStore.getState().update('measure', { atoms: [] });
          useToolStore.getState().update('bondCentric', { bond: null });
        }
        // undo/redo replaced the document the running gesture was editing
        if (s.historyRevision !== prev.historyRevision && this.dragging) this.abortGesture();
      }),
    );
    if (element) this.bind(element);
  }

  get activeTool(): Tool {
    return this.active;
  }

  private toolById(id: ToolId): Tool {
    return this.tools.find((t) => t.id === id) ?? this.tools[0]!;
  }

  private enter(tool: Tool): void {
    this.ctx.renderer.controller.enabled = CAMERA_TOOLS.has(tool.id);
    this.ctx.setCursor(tool.id === 'navigate' ? 'grab' : 'crosshair');
    tool.activate?.(this.ctx);
  }

  private switchTo(id: ToolId): void {
    this.active.deactivate?.(this.ctx);
    // a tool change mid-gesture must not leave preview geometry behind
    useStructureStore.getState().cancelPreview();
    this.active.cancelGesture?.(this.ctx);
    this.dragging = false;
    useToolStore.getState().update('select', { rect: null });
    this.active = this.toolById(id);
    this.enter(this.active);
  }

  /**
   * Drop the running gesture: the tool forgets its base document and the remaining pointer events
   * of this drag are ignored, so nothing is committed against a document that no longer exists.
   */
  private abortGesture(): void {
    this.active.cancelGesture?.(this.ctx);
    this.dragging = false;
    this.gestureAborted = true;
  }

  pointerDown(e: PointerLike): void {
    this.dragging = true;
    this.gestureAborted = false;
    this.active.onPointerDown?.(e, this.ctx);
  }

  pointerMove(e: PointerLike): void {
    if (this.gestureAborted) return;
    if (!this.dragging && e.buttons === 0) this.scheduleHover(e.clientX, e.clientY);
    this.active.onPointerMove?.(e, this.ctx);
  }

  /**
   * Hover picking raycasts every atom and bond instance, so it runs at most once per animation
   * frame and only after the pointer has actually travelled a couple of pixels.
   */
  private scheduleHover(x: number, y: number): void {
    const last = this.lastHoverPick;
    if (last && Math.hypot(x - last.x, y - last.y) < HOVER_MIN_MOVE_PX) return;
    this.pendingHover = { x, y };
    if (this.hoverFrame !== null) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = null;
      const p = this.pendingHover;
      this.pendingHover = null;
      if (!p || this.dragging) return;
      this.lastHoverPick = p;
      const hit = this.ctx.renderer.pick(p.x, p.y);
      const idx = hit?.kind === 'atom' ? hit.index : null;
      if (idx !== useSelectionStore.getState().hoveredAtom) {
        useSelectionStore.getState().setHovered(idx);
      }
    });
  }

  pointerUp(e: PointerLike): void {
    this.dragging = false;
    if (this.gestureAborted) {
      this.gestureAborted = false;
      return;
    }
    this.active.onPointerUp?.(e, this.ctx);
  }

  doubleClick(e: PointerLike): void {
    this.active.onDoubleClick?.(e, this.ctx);
  }

  wheel(e: WheelLike): void {
    this.active.onWheel?.(e, this.ctx);
  }

  /** Returns true when the key was consumed (tool shortcut or tool-specific key). */
  keyDown(e: KeyLike): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const tool = this.tools.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase());
    if (tool && !e.shiftKey) {
      useToolStore.getState().setActive(tool.id);
      return true;
    }
    return this.active.onKeyDown?.(e, this.ctx) ?? false;
  }

  private bind(el: HTMLElement): void {
    const onDown = (e: PointerEvent): void => {
      this.pointerDown(e);
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onUp);
    };
    const onWindowMove = (e: PointerEvent): void => this.pointerMove(e);
    const onHover = (e: PointerEvent): void => {
      if (!this.dragging) this.pointerMove(e);
    };
    const onUp = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onUp);
      this.pointerUp(e);
    };
    const onDbl = (e: MouseEvent): void => this.doubleClick(e);
    const onWheel = (e: WheelEvent): void => this.wheel(e);
    const onKey = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return;
      if (this.keyDown(e)) e.preventDefault();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onHover);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    this.unsubscribe.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onHover);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    });
  }

  dispose(): void {
    if (this.hoverFrame !== null) cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = null;
    this.pendingHover = null;
    this.active.deactivate?.(this.ctx);
    for (const u of this.unsubscribe) u();
    this.unsubscribe.length = 0;
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
