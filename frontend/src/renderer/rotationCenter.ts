/**
 * What a left drag turns about.
 *
 * Avogadro picks this per drag rather than always using the centre of the molecule
 * (`libavogadro/src/tools/navigatetool.cpp:78-105`), which is what stops a rotation from swinging
 * the structure around a point that is no longer on the screen. This is that rule, with the
 * selection put ahead of it: turning about what was chosen is what choosing it was for.
 */
import { Matrix4, Vector3 } from 'three';

/** Just enough of an atom to place it. */
export interface Placed {
  readonly position: readonly number[];
}

const at = (a: Placed): Vector3 => new Vector3(a.position[0], a.position[1], a.position[2]);

/**
 * The centroid of the selected atoms, or `null` when nothing usable is selected.
 */
export function selectionCentre(
  atoms: readonly Placed[],
  selected: ReadonlySet<number> | undefined,
): Vector3 | null {
  if (!selected?.size) return null;
  const centre = new Vector3();
  let n = 0;
  for (const i of selected) {
    const atom = atoms[i];
    if (!atom) continue;
    centre.add(at(atom));
    n += 1;
  }
  return n ? centre.divideScalar(n) : null;
}

/**
 * The barycentre of the atoms weighted towards the middle of the view: `exp(-30(1 + cos t))` with
 * `t` from the direction the camera looks, so an atom on the optical axis and in front weighs 1,
 * one behind weighs nothing, and the fall-off is sharp enough that the answer is the part of the
 * structure actually being looked at. `view` is the camera's `matrixWorldInverse`.
 */
export function visibleBarycentre(atoms: readonly Placed[], view: Matrix4): Vector3 | null {
  const centre = new Vector3();
  const camera = new Vector3();
  let total = 0;
  for (const atom of atoms) {
    const world = at(atom);
    camera.copy(world).applyMatrix4(view);
    const distance = camera.length();
    // an atom exactly at the camera has no direction; it is as central as an atom can be
    const weight = distance < 1e-9 ? 1 : Math.exp(-30 * (1 + camera.z / distance));
    centre.addScaledVector(world, weight);
    total += weight;
  }
  return total > 0 ? centre.divideScalar(total) : null;
}

/**
 * The three tiers in order: the selection, then the atom the drag started on, then what is being
 * looked at. Null when there is nothing to turn about, which leaves the pivot in charge.
 */
export function rotationCentre(
  atoms: readonly Placed[],
  selected: ReadonlySet<number> | undefined,
  grabbed: number | null,
  view: Matrix4,
): Vector3 | null {
  if (!atoms.length) return null;
  const chosen = selectionCentre(atoms, selected);
  if (chosen) return chosen;
  const under = grabbed === null ? undefined : atoms[grabbed];
  if (under) return at(under);
  return visibleBarycentre(atoms, view);
}
