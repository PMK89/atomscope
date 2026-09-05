/**
 * Hydrogen bonds by geometry (Avogadro's Hydrogen Bond engine).
 *
 * A hydrogen bond here is a hydrogen bonded to N, O or F pointing at another N, O or F: the
 * donor-acceptor distance must be within the cut-off and the D-H...A angle wide enough. That is
 * the standard geometric criterion, and it is computed in the frontend rather than fetched so
 * that it follows a trajectory frame and a drag without a round trip.
 */
import type { StructureDoc, Vec3 } from './structure';

export interface HBondSettings {
  /** Donor-acceptor distance cut-off in Angstrom. */
  maxDistance: number;
  /** Minimum D-H...A angle in degrees; below it the hydrogen is not pointing at the acceptor. */
  minAngle: number;
}

export const DEFAULT_HBOND_SETTINGS: HBondSettings = { maxDistance: 3.2, minAngle: 120 };

/** Elements that donate through a hydrogen and accept a hydrogen bond. */
const POLAR = new Set(['N', 'O', 'F']);

/** More than this and the scene is unreadable anyway; the search stops there. */
export const MAX_HBONDS = 5000;

export interface HydrogenBond {
  hydrogen: number;
  donor: number;
  acceptor: number;
  /** donor-acceptor distance in Angstrom */
  distance: number;
}

type PositionOf = (index: number) => Vec3;

/** Uniform grid over the acceptors, so a hydrogen only looks at the cells around it. */
class Grid {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly size: number,
    indices: number[],
    at: PositionOf,
  ) {
    for (const i of indices) {
      const key = this.key(at(i));
      const cell = this.cells.get(key);
      if (cell) cell.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private key(p: Vec3): string {
    return `${Math.floor(p[0] / this.size)},${Math.floor(p[1] / this.size)},${Math.floor(p[2] / this.size)}`;
  }

  near(p: Vec3): number[] {
    const out: number[] = [];
    const [x, y, z] = [
      Math.floor(p[0] / this.size),
      Math.floor(p[1] / this.size),
      Math.floor(p[2] / this.size),
    ];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = this.cells.get(`${x + dx},${y + dy},${z + dz}`);
          if (cell) out.push(...cell);
        }
      }
    }
    return out;
  }
}

const angleDegrees = (a: Vec3, b: Vec3, c: Vec3): number => {
  const u: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const nu = Math.hypot(u[0], u[1], u[2]);
  const nv = Math.hypot(v[0], v[1], v[2]);
  if (nu < 1e-9 || nv < 1e-9) return 0;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
};

/**
 * Every hydrogen bond in `doc`, measured on the positions `at` returns (so a trajectory frame or
 * a drag preview is what gets tested, not the stored geometry).
 */
export function hydrogenBonds(
  doc: StructureDoc,
  at: PositionOf,
  settings: HBondSettings = DEFAULT_HBOND_SETTINGS,
): HydrogenBond[] {
  const heavyOf = new Map<number, number>(); // hydrogen -> the atom it is bonded to
  const bondedTo = new Map<number, Set<number>>();
  for (const b of doc.bonds) {
    for (const [i, j] of [
      [b.a, b.b],
      [b.b, b.a],
    ] as const) {
      if (!bondedTo.has(i)) bondedTo.set(i, new Set());
      bondedTo.get(i)!.add(j);
      if (doc.atoms[i]?.element === 'H' && POLAR.has(doc.atoms[j]?.element ?? '')) {
        heavyOf.set(i, j);
      }
    }
  }
  const acceptors: number[] = [];
  doc.atoms.forEach((a, i) => {
    if (POLAR.has(a.element)) acceptors.push(i);
  });
  if (!heavyOf.size || !acceptors.length) return [];

  const grid = new Grid(settings.maxDistance, acceptors, at);
  const out: HydrogenBond[] = [];
  for (const [hydrogen, donor] of heavyOf) {
    const hp = at(hydrogen);
    const dp = at(donor);
    for (const acceptor of grid.near(hp)) {
      // an acceptor cannot be the donor itself, nor anything the donor is bonded to: those are
      // covalent neighbours, not a hydrogen bond
      if (acceptor === donor || bondedTo.get(donor)?.has(acceptor)) continue;
      const ap = at(acceptor);
      const distance = Math.hypot(ap[0] - dp[0], ap[1] - dp[1], ap[2] - dp[2]);
      if (distance > settings.maxDistance) continue;
      if (angleDegrees(dp, hp, ap) < settings.minAngle) continue;
      out.push({ hydrogen, donor, acceptor, distance });
      if (out.length >= MAX_HBONDS) return out;
    }
  }
  return out;
}
