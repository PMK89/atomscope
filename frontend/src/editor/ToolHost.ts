/**
 * Binds the active tool to the canvas: pointer capture, hover highlighting, keyboard shortcuts
 * and tool activation/deactivation. Dispatch methods are public so tests can drive tools with
 * plain objects instead of DOM events.
 */
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import type { KeyLike, PointerLike, Tool, ToolContext, ToolId, ToolRenderer } from './Tool';
import { useToolStore } from './toolStore';

const CAMERA_TOOLS: ReadonlySet<ToolId> = new Set(['navigate', 'auto-rotate']);

export class ToolHost {
  readonly ctx: ToolContext;
  private active: Tool;
  private readonly unsubscribe: (() => void)[] = [];
  private dragging = false;

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
    useToolStore.getState().update('select', { rect: null });
    this.active = this.toolById(id);
    this.enter(this.active);
  }

  pointerDown(e: PointerLike): void {
    this.dragging = true;
    this.active.onPointerDown?.(e, this.ctx);
  }

  pointerMove(e: PointerLike): void {
    if (!this.dragging && e.buttons === 0) {
      const hit = this.ctx.renderer.pick(e.clientX, e.clientY);
      const idx = hit?.kind === 'atom' ? hit.index : null;
      if (idx !== useSelectionStore.getState().hoveredAtom) {
        useSelectionStore.getState().setHovered(idx);
      }
    }
    this.active.onPointerMove?.(e, this.ctx);
  }

  pointerUp(e: PointerLike): void {
    this.dragging = false;
    this.active.onPointerUp?.(e, this.ctx);
  }

  doubleClick(e: PointerLike): void {
    this.active.onDoubleClick?.(e, this.ctx);
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
    const onKey = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return;
      if (this.keyDown(e)) e.preventDefault();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onHover);
    el.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    this.unsubscribe.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onHover);
      el.removeEventListener('dblclick', onDbl);
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    });
  }

  dispose(): void {
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
