/**
 * Coordination polyhedra: Avogadro's Polygon engine (`polygonengine.cpp`).
 *
 * It draws, around each atom that qualifies, the solid whose corners are that atom's neighbours --
 * a tetrahedron around a four-coordinate site, an octahedron around a six-coordinate one. That is
 * how a crystal structure is usually drawn when what matters is the coordination rather than the
 * bonds: NiO as edge-sharing octahedra, a silicate as corner-sharing tetrahedra.
 *
 * Which atoms qualify is Avogadro's rule, read off `renderPolygon`: hydrogen, carbon, nitrogen,
 * oxygen and sulphur are skipped whatever their valence, and every other element is drawn only
 * when it has four or more neighbours. So the polyhedra appear around the metal sites and not
 * around the ligands, which is what makes the picture readable.
 *
 * The faces here are the convex hull of the neighbours. Avogadro instead sprays a triangle for
 * every ordered triple of neighbours, which covers the same silhouette for the small coordination
 * numbers it is used on but also fills the interior with hidden faces -- visible as soon as the
 * polyhedron is made transparent, and quadratically wasteful at higher coordination. The hull is
 * what its triangle spray is approximating.
 */

import type { StructureDoc, Vec3 } from './structure';

/** Elements Avogadro's polygon engine never draws a polyhedron around. */
export const POLYGON_SKIP_Z: ReadonlySet<number> = new Set([1, 6, 7, 8, 16]);

/** Fewest neighbours Avogadro draws a polyhedron for (`a->valence() < 4` is skipped). */
export const MIN_COORDINATION = 4;

/** Below this a triple of neighbours is collinear and spans no face. */
const AREA_EPSILON = 1e-6;

/** How far outside a face plane a point may lie and still count as on it. */
const PLANE_EPSILON = 1e-6;

export interface Polyhedron {
  /** the atom at the centre, whose colour the solid takes */
  center: number;
  /** triangles, wound so the normal points away from the centre */
  faces: [Vec3, Vec3, Vec3][];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The convex hull of `points`, as triangles wound so their normals point away from `inside`.
 *
 * Brute force: a triple spans a hull face when every other point is on one side of its plane.
 * That is O(n^4), which is irrelevant here -- a coordination number above about twelve does not
 * occur, and the alternative would be an incremental hull with degeneracy handling to match.
 *
 * Triples that turn out to lie on the same plane are merged and fanned once, so a face with more
 * than three corners -- the square base of a pyramid -- is covered exactly once. A flat set
 * (square-planar four-coordination) is then a single face, drawn filled, with no special case.
 */
export function hullFaces(points: Vec3[], inside: Vec3): [Vec3, Vec3, Vec3][] {
  /** accepted planes, keyed by orientation and offset, each with the points lying on it */
  const planes = new Map<string, { normal: Vec3; members: Set<number> }>();
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const a = points[i]!;
        const raw = cross(sub(points[j]!, a), sub(points[k]!, a));
        const length = Math.hypot(...raw);
        if (length < AREA_EPSILON) continue; // collinear: no face
        // outward from the centre, so a plane found from two different triples keys the same
        const sign = dot(raw, sub(a, inside)) >= 0 ? 1 : -1;
        const normal: Vec3 = [
          (raw[0] / length) * sign,
          (raw[1] / length) * sign,
          (raw[2] / length) * sign,
        ];
        const offset = dot(normal, a);
        let above = false;
        let below = false;
        const members = new Set([i, j, k]);
        for (let p = 0; p < points.length; p++) {
          if (members.has(p)) continue;
          const side = dot(normal, points[p]!) - offset;
          if (side > PLANE_EPSILON) above = true;
          else if (side < -PLANE_EPSILON) below = true;
          else members.add(p); // on the plane: part of this face
          if (above && below) break;
        }
        // `above` means a point is outside the plane, so this is not a hull face. (`below` alone
        // cannot happen: the normal was already turned outward.)
        if (above) continue;
        const key = [...normal, offset].map((v) => v.toFixed(4)).join(',');
        const found = planes.get(key);
        if (found) for (const m of members) found.members.add(m);
        else planes.set(key, { normal, members });
      }
    }
  }

  // One fan per face rather than one triangle per triple: a face with more than three corners --
  // the square base of a pyramid, or a whole square-planar set -- would otherwise be covered
  // several times over, which is invisible while it is opaque and twice as dark once it is not.
  const faces: [Vec3, Vec3, Vec3][] = [];
  for (const { normal, members } of planes.values()) {
    const corners = [...members].map((m) => points[m]!);
    const centroid: Vec3 = [0, 1, 2].map(
      (c) => corners.reduce((sum, p) => sum + p[c]!, 0) / corners.length,
    ) as Vec3;
    // an axis pair in the plane, to sort the corners by angle about the centroid
    const u = sub(corners[0]!, centroid);
    const uLength = Math.hypot(...u);
    if (uLength < AREA_EPSILON) continue;
    const ux: Vec3 = [u[0] / uLength, u[1] / uLength, u[2] / uLength];
    const uy = cross(normal, ux);
    const ordered = corners
      .map((p) => {
        const d = sub(p, centroid);
        return { p, angle: Math.atan2(dot(d, uy), dot(d, ux)) };
      })
      .sort((a, b) => a.angle - b.angle)
      .map((e) => e.p);
    for (let t = 1; t + 1 < ordered.length; t++) {
      faces.push([ordered[0]!, ordered[t]!, ordered[t + 1]!]);
    }
  }
  return faces;
}

/**
 * The polyhedra to draw for a structure. `at` supplies positions so a trajectory frame or a drag
 * is followed; `hidden` are the atoms display scoping has taken out of the view, and a hidden
 * atom is neither a centre nor a corner.
 */
export function coordinationPolyhedra(
  structure: StructureDoc,
  at: (index: number) => Vec3,
  hidden: ReadonlySet<number> | null = null,
  atomicNumber: (element: string) => number,
): Polyhedron[] {
  const neighbours: number[][] = structure.atoms.map(() => []);
  for (const bond of structure.bonds) {
    if (hidden?.has(bond.a) || hidden?.has(bond.b)) continue;
    neighbours[bond.a]?.push(bond.b);
    neighbours[bond.b]?.push(bond.a);
  }
  const out: Polyhedron[] = [];
  structure.atoms.forEach((atom, index) => {
    if (hidden?.has(index)) return;
    if (POLYGON_SKIP_Z.has(atomicNumber(atom.element))) return;
    const around = neighbours[index]!;
    if (around.length < MIN_COORDINATION) return;
    const faces = hullFaces(
      around.map((n) => at(n)),
      at(index),
    );
    if (faces.length) out.push({ center: index, faces });
  });
  return out;
}
