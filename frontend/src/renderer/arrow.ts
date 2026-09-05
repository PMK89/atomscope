import { Matrix4, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const dir = new Vector3();
const quat = new Quaternion();
const scale = new Vector3();
const pos = new Vector3();

export interface ArrowDims {
  shaftRadius: number;
  headRadius: number;
  /** Cone length; clamped to half the arrow length for short arrows. */
  headLength: number;
}

/**
 * Transforms for an arrow from `origin` along `vector`: a unit cylinder (height 1 along +Y,
 * centered) for the shaft and a unit cone (ConeGeometry(1, 1): base at y=-0.5, tip at y=+0.5) for
 * the head. Returns the arrow length; below `minLength` both matrices collapse to zero scale.
 */
export function arrowMatrices(
  origin: Vector3,
  vector: Vector3,
  dims: ArrowDims,
  minLength: number,
  outShaft: Matrix4,
  outHead: Matrix4,
): number {
  const length = vector.length();
  if (length < Math.max(minLength, 1e-9)) {
    scale.set(0, 0, 0);
    outShaft.identity().scale(scale);
    outHead.identity().scale(scale);
    return length;
  }
  dir.copy(vector).divideScalar(length);
  quat.setFromUnitVectors(UP, dir);
  const head = Math.min(dims.headLength, length * 0.5);
  const shaft = length - head;
  pos.copy(origin).addScaledVector(dir, shaft * 0.5);
  scale.set(dims.shaftRadius, shaft, dims.shaftRadius);
  outShaft.compose(pos, quat, scale);
  pos.copy(origin).addScaledVector(dir, shaft + head * 0.5);
  scale.set(dims.headRadius, head, dims.headRadius);
  outHead.compose(pos, quat, scale);
  return length;
}
