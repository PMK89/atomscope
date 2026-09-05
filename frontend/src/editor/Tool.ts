/**
 * Editor tool contract. Tools are plain classes without React or DOM dependencies: they receive
 * pointer-like objects and a ToolContext (renderer facade + stores) so they can be unit-tested
 * against a fake renderer. The ToolHost (see ToolHost.ts) binds them to the canvas.
 */
import type { Vector3 } from 'three';
import type { PickResult } from '../renderer/Renderer';
import type { useSelectionStore } from '../state/selectionStore';
import type { useStructureStore } from '../state/structureStore';
import type { useToolStore } from './toolStore';

export type ToolId =
  'navigate' | 'select' | 'draw' | 'manipulate' | 'bond-centric' | 'measure' | 'auto-rotate';

export interface PointerLike {
  clientX: number;
  clientY: number;
  /** 0 left, 1 middle, 2 right (as in PointerEvent) */
  button: number;
  /** bitmask of held buttons (1 left, 2 right, 4 middle) */
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Subset of CameraController used by tools. */
export interface ToolCamera {
  readonly pivot: Vector3;
  enabled: boolean;
  setPivot(center: Vector3): void;
  rotateBy(azimuth: number, polar: number): void;
  roll(angle: number): void;
  viewDirection(out: Vector3): Vector3;
  worldPerPixel(): number;
  axes(): { right: Vector3; up: Vector3; forward: Vector3 };
}

/** Subset of Renderer used by tools; the real Renderer satisfies it structurally. */
export interface ToolRenderer {
  readonly controller: ToolCamera;
  pick(clientX: number, clientY: number): PickResult | null;
  project(world: Vector3): { x: number; y: number };
  toCanvasCoords(clientX: number, clientY: number): { x: number; y: number };
  unprojectOnPlane(clientX: number, clientY: number, planePoint: Vector3): Vector3;
  unprojectOnPivotPlane(clientX: number, clientY: number): Vector3;
  fitToStructure(): void;
  invalidate(): void;
}

export interface ToolContext {
  renderer: ToolRenderer;
  structure: typeof useStructureStore;
  selection: typeof useSelectionStore;
  tools: typeof useToolStore;
  setCursor(cursor: string): void;
}

/** Shapes drawn by the HTML/SVG overlay, in CSS pixels relative to the canvas. */
export type OverlayShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'marker'; x: number; y: number; text: string }
  | { kind: 'label'; x: number; y: number; text: string };

export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  /** Short glyph shown on the toolbar button. */
  readonly icon: string;
  /** Single-key shortcut (no modifier). */
  readonly shortcut: string;
  readonly description: string;
  activate?(ctx: ToolContext): void;
  deactivate?(ctx: ToolContext): void;
  onPointerDown?(e: PointerLike, ctx: ToolContext): void;
  onPointerMove?(e: PointerLike, ctx: ToolContext): void;
  onPointerUp?(e: PointerLike, ctx: ToolContext): void;
  onDoubleClick?(e: PointerLike, ctx: ToolContext): void;
  /** Return true when the key was consumed. */
  onKeyDown?(e: KeyLike, ctx: ToolContext): boolean;
  /** Shapes to draw over the canvas for the current state. */
  overlay?(ctx: ToolContext): OverlayShape[];
}

export const DRAG_THRESHOLD_PX = 3;

export function pointerModifier(e: PointerLike): 'replace' | 'add' | 'toggle' {
  if (e.ctrlKey || e.metaKey) return 'toggle';
  if (e.shiftKey) return 'add';
  return 'replace';
}
