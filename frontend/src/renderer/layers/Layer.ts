import type { Camera, Object3D, WebGLRenderer } from 'three';
import type { Cell, StructureDoc } from '../../model/structure';

export interface LayerContext {
  structure: StructureDoc;
  revision: number;
  selectedAtoms: ReadonlySet<number>;
  hoveredAtom: number | null;
  /**
   * Display-only geometry (e.g. a trajectory frame): 3 floats per atom replacing the structure's
   * positions, and optionally a cell. Layers keep topology/colors from `structure`.
   */
  positionsOverride?: Float32Array | null;
  cellOverride?: Cell['vectors'] | null;
}

/** A display layer owns Three.js objects and rebuilds them from a structure snapshot. */
export interface DisplayLayer {
  readonly id: string;
  readonly object: Object3D;
  visible: boolean;
  update(ctx: LayerContext): void;
  dispose(): void;
  /** Optional second pass after the main scene (e.g. a corner gizmo with its own camera). */
  renderOverlay?(gl: WebGLRenderer, camera: Camera): void;
}
