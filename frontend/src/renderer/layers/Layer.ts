import type { Object3D } from 'three';
import type { StructureDoc } from '../../model/structure';

export interface LayerContext {
  structure: StructureDoc;
  revision: number;
  selectedAtoms: ReadonlySet<number>;
  hoveredAtom: number | null;
}

/** A display layer owns Three.js objects and rebuilds them from a structure snapshot. */
export interface DisplayLayer {
  readonly id: string;
  readonly object: Object3D;
  visible: boolean;
  update(ctx: LayerContext): void;
  dispose(): void;
}
