import { Matrix4, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const tmpDir = new Vector3();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const tmpPos = new Vector3();

/**
 * Transform mapping a unit cylinder (height 1 along +Y, centered at origin) onto the segment
 * from `a` to `b` with the given radius. Writes into `out`.
 */
export function cylinderMatrix(a: Vector3, b: Vector3, radius: number, out: Matrix4): Matrix4 {
  tmpDir.subVectors(b, a);
  const length = tmpDir.length();
  if (length < 1e-9) {
    return out.identity().scale(tmpScale.set(0, 0, 0));
  }
  tmpDir.divideScalar(length);
  tmpQuat.setFromUnitVectors(UP, tmpDir);
  tmpPos.addVectors(a, b).multiplyScalar(0.5);
  tmpScale.set(radius, length, radius);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

/** Two offset points for a double bond (perpendicular to the bond and to the view direction). */
export function bondOffsetAxis(a: Vector3, b: Vector3, viewDir: Vector3, out: Vector3): Vector3 {
  tmpDir.subVectors(b, a).normalize();
  out.crossVectors(tmpDir, viewDir);
  if (out.lengthSq() < 1e-8) out.crossVectors(tmpDir, UP);
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
  return out.normalize();
}

/**
 * Unit vector perpendicular to the bond a-b, in the plane the bond makes with `reference`. That is
 * where the extra sticks of a double or triple bond belong: in the plane of the molecule, not at
 * some arbitrary angle to it. Falls back to any perpendicular when there is no reference atom (a
 * lone diatomic) or when the three atoms are collinear.
 */
export function bondPlaneAxis(
  a: Vector3,
  b: Vector3,
  reference: Vector3 | null,
  out: Vector3,
): Vector3 {
  tmpDir.subVectors(b, a).normalize();
  out.set(0, 0, 0);
  if (reference) {
    out.subVectors(reference, a);
    out.addScaledVector(tmpDir, -out.dot(tmpDir));
  }
  if (out.lengthSq() < 1e-8) out.crossVectors(tmpDir, UP);
  if (out.lengthSq() < 1e-8) out.crossVectors(tmpDir, RIGHT);
  return out.normalize();
}
