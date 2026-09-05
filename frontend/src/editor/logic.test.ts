import {
  fragmentOf,
  fragments,
  minimumImageDistance,
  perceiveBondsForAtom,
  sideOfBond,
} from '../model/connectivity';
import { angleDeg, dihedralDeg, distance, rotateAbout } from '../model/geometry';
import {
  makeAtom,
  makeBond,
  normalizeStructure,
  type Cell,
  type StructureDoc,
  type Vec3,
} from '../model/structure';
import {
  addAtom,
  cycleBondOrder,
  remapAfterRemoval,
  removeAtoms,
  rotateAtoms,
  setBondLength,
} from './edits';
import { formatMeasurement, measure } from './measure';
import { atomsInRect, combineSelection, expandSelection, invertSelection } from './selectionMath';
import { adjustHydrogens, substituentDirections } from './valence';

function doc(atoms: [string, number, number, number][], bonds: [number, number][]): StructureDoc {
  return normalizeStructure({
    name: 't',
    charge: 0,
    atoms: atoms.map(([e, x, y, z]) => makeAtom(e, [x, y, z])),
    bonds: bonds.map(([a, b]) => makeBond(a, b)),
  });
}

const water = () =>
  doc(
    [
      ['O', 0, 0, 0.1173],
      ['H', 0, 0.7572, -0.4692],
      ['H', 0, -0.7572, -0.4692],
    ],
    [
      [0, 1],
      [0, 2],
    ],
  );

describe('geometry', () => {
  test('angle of water', () => {
    const w = water();
    expect(angleDeg(w.atoms[1]!.position, w.atoms[0]!.position, w.atoms[2]!.position)).toBeCloseTo(
      104.5,
      0,
    );
  });
  test('dihedral sign follows IUPAC (clockwise positive looking along b->c)', () => {
    expect(dihedralDeg([1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1])).toBeCloseTo(90);
    expect(dihedralDeg([1, 0, 0], [0, 0, 0], [0, 0, 1], [0, -1, 1])).toBeCloseTo(-90);
    expect(dihedralDeg([1, 0, 0], [0, 0, 0], [0, 0, 1], [-1, 0, 1])).toBeCloseTo(180);
    expect(Math.abs(dihedralDeg([1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]))).toBeCloseTo(0);
  });
  test('rotateAbout rotates 90 degrees about z', () => {
    const p = rotateAbout([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(1);
  });
});

describe('connectivity', () => {
  const two = doc(
    [
      ['C', 0, 0, 0],
      ['C', 1.5, 0, 0],
      ['O', 10, 0, 0],
      ['H', 10.9, 0, 0],
    ],
    [
      [0, 1],
      [2, 3],
    ],
  );
  test('fragments and fragmentOf', () => {
    expect(fragments(two)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect([...fragmentOf(two, 3)].sort()).toEqual([2, 3]);
  });
  test('sideOfBond returns the moving side, single atom for ring bonds', () => {
    const chain = doc(
      [
        ['C', 0, 0, 0],
        ['C', 1.5, 0, 0],
        ['C', 3, 0, 0],
        ['H', 3.5, 1, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    expect([...sideOfBond(chain, 1, 2)].sort()).toEqual([2, 3]);
    const ring = doc(
      [
        ['C', 0, 0, 0],
        ['C', 1, 0, 0],
        ['C', 0, 1, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    );
    expect([...sideOfBond(ring, 0, 1)]).toEqual([1]);
  });
  test('perceiveBondsForAtom uses 1.15 * covalent radius sum', () => {
    const d = doc(
      [
        ['C', 0, 0, 0],
        ['C', 1.5, 0, 0],
        ['C', 1.8, 0, 0],
      ],
      [],
    );
    // C-C cutoff = 1.15 * 1.52 = 1.748: atom 1 bonds to 0 (1.5) and 2 (0.3), not 0-2 (1.8)
    expect(perceiveBondsForAtom(d, 1).map((b) => [b.a, b.b])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(perceiveBondsForAtom(d, 0).map((b) => [b.a, b.b])).toEqual([[0, 1]]);
  });
});

describe('periodic bond perception', () => {
  const cellOf = (vectors: Vec3[], pbc: [boolean, boolean, boolean]): Cell =>
    ({ vectors, pbc }) as Cell;
  const ortho = (pbc: [boolean, boolean, boolean] = [true, true, true]): Cell =>
    cellOf(
      [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      pbc,
    );
  // gamma = 60 degrees, |b| = 10
  const triclinic = cellOf(
    [
      [10, 0, 0],
      [5, 8.6602540378, 0],
      [0, 0, 10],
    ],
    [true, true, true],
  );
  /** Shortest distance found by scanning lattice images directly. */
  const brute = (a: Vec3, b: Vec3, cell: Cell): number => {
    const [va, vb, vc] = cell.vectors as [Vec3, Vec3, Vec3];
    let best = Infinity;
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++)
        for (let k = -2; k <= 2; k++) {
          const p: Vec3 = [
            b[0] + i * va[0] + j * vb[0] + k * vc[0],
            b[1] + i * va[1] + j * vb[1] + k * vc[1],
            b[2] + i * va[2] + j * vb[2] + k * vc[2],
          ];
          best = Math.min(best, distance(a, p));
        }
    return best;
  };
  const withCell = (
    atoms: [string, number, number, number][],
    cell: Cell | null,
  ): StructureDoc => ({ ...doc(atoms, []), cell });

  test('an orthorhombic cell bonds atoms across the boundary', () => {
    const atoms: [string, number, number, number][] = [
      ['C', 0.2, 0, 0],
      ['C', 8.8, 0, 0],
    ];
    // direct distance 8.6, minimum image 1.4 < 1.15 * 1.52
    expect(perceiveBondsForAtom(withCell(atoms, ortho()), 0).map((b) => [b.a, b.b])).toEqual([
      [0, 1],
    ]);
    // the same atoms without a cell, or with x aperiodic, stay unbonded
    expect(perceiveBondsForAtom(withCell(atoms, null), 0)).toEqual([]);
    expect(perceiveBondsForAtom(withCell(atoms, ortho([false, true, true])), 0)).toEqual([]);
  });

  test('a triclinic cell bonds along the skewed axis', () => {
    // fractional (0, 0.9, 0): 9.0 Å away directly, 1.0 Å to the image at (0, -0.1, 0)
    const atoms: [string, number, number, number][] = [
      ['C', 0, 0, 0],
      ['C', 4.5, 7.7942286340158, 0],
    ];
    expect(perceiveBondsForAtom(withCell(atoms, triclinic), 0).map((b) => [b.a, b.b])).toEqual([
      [0, 1],
    ]);
    expect(
      minimumImageDistance(atoms[0]!.slice(1) as Vec3, [4.5, 7.7942286340158, 0], triclinic),
    ).toBeCloseTo(1, 6);
  });

  test('minimum-image distances match a direct image scan, including a strongly skewed cell', () => {
    const skewed = cellOf(
      [
        [10, 0, 0],
        [9, 3, 0],
        [0, 0, 10],
      ],
      [true, true, true],
    );
    const pairs: [Vec3, Vec3][] = [
      [
        [0, 0, 0],
        [9.5, 1.5, 0],
      ],
      [
        [1, 2, 3],
        [8.4, 0.6, 9.2],
      ],
      [
        [0.5, 0.5, 0.5],
        [1.5, 0.5, 0.5],
      ],
    ];
    for (const [a, b] of pairs) {
      for (const cell of [ortho(), triclinic, skewed]) {
        expect(minimumImageDistance(a, b, cell)).toBeCloseTo(brute(a, b, cell), 9);
      }
    }
  });

  test('a singular cell falls back to Cartesian distances', () => {
    const flat = cellOf(
      [
        [10, 0, 0],
        [10, 0, 0],
        [0, 0, 10],
      ],
      [true, true, true],
    );
    expect(minimumImageDistance([0, 0, 0], [3, 4, 0], flat)).toBeCloseTo(5, 9);
  });
});

describe('valence / hydrogens', () => {
  test('substituent templates have ideal angles', () => {
    const tet = substituentDirections([], 4);
    expect(tet).toHaveLength(4);
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        expect(angleDeg(tet[i]!, [0, 0, 0], tet[j]!)).toBeCloseTo(109.47, 1);
    const tri = substituentDirections([[1, 0, 0]], 2);
    expect(angleDeg(tri[0]!, [0, 0, 0], [1, 0, 0])).toBeCloseTo(120, 1);
    expect(angleDeg(tri[0]!, [0, 0, 0], tri[1]!)).toBeCloseTo(120, 1);
    const lin = substituentDirections([[0, 1, 0]], 1);
    expect(lin[0]![1]).toBeCloseTo(-1);
    const two = substituentDirections(
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      2,
    );
    expect(angleDeg(two[0]!, [0, 0, 0], two[1]!)).toBeCloseTo(109.47, 1);
  });
  test('bare carbon becomes methane with 1.09 A C-H bonds', () => {
    const d = adjustHydrogens(doc([['C', 0, 0, 0]], []), 0);
    expect(d.atoms).toHaveLength(5);
    expect(d.bonds).toHaveLength(4);
    for (const a of d.atoms.slice(1)) expect(Math.hypot(...a.position)).toBeCloseTo(1.09);
  });
  test('valence uses bond-order sum; excess hydrogens are removed', () => {
    let d = doc(
      [
        ['C', 0, 0, 0],
        ['O', 1.2, 0, 0],
      ],
      [[0, 1]],
    );
    d = { ...d, bonds: [makeBond(0, 1, 2)] };
    d = adjustHydrogens(d, 0);
    expect(d.atoms.filter((a) => a.element === 'H')).toHaveLength(2);
    d = adjustHydrogens(d, 1);
    expect(d.atoms).toHaveLength(4);
    // carbon of methane bonded to a second carbon loses one H
    let eth = adjustHydrogens(doc([['C', 0, 0, 0]], []), 0);
    const { doc: withC, index } = addAtom(eth, 'C', [1.5, 0, 0]);
    eth = { ...withC, bonds: [...withC.bonds, makeBond(0, index)] };
    eth = adjustHydrogens(eth, 0);
    expect(eth.atoms.filter((a) => a.element === 'H')).toHaveLength(3);
    expect(adjustHydrogens(eth, 0)).toBe(eth);
  });
  test('unknown elements are left alone', () => {
    const d = doc([['Fe', 0, 0, 0]], []);
    expect(adjustHydrogens(d, 0)).toBe(d);
  });
});

describe('edits', () => {
  test('removeAtoms remaps bonds and remapAfterRemoval agrees', () => {
    const w = water();
    const d = removeAtoms(w, [1]);
    expect(d.atoms).toHaveLength(2);
    expect(d.bonds).toEqual([{ a: 0, b: 1, order: 1, aromatic: false }]);
    expect(remapAfterRemoval(new Set([1]), [0, 1, 2])).toEqual([0, 1]);
  });
  test('cycleBondOrder wraps 1 -> 2 -> 3 -> 1', () => {
    let d = water();
    d = cycleBondOrder(d, 0);
    expect(d.bonds[0]!.order).toBe(2);
    d = cycleBondOrder(d, 0);
    expect(d.bonds[0]!.order).toBe(3);
    d = cycleBondOrder(d, 0);
    expect(d.bonds[0]!.order).toBe(1);
  });
  test('addAtom with perception bonds to atoms in range', () => {
    const { doc: d } = addAtom(doc([['C', 0, 0, 0]], []), 'H', [1.0, 0, 0], true);
    expect(d.bonds).toHaveLength(1);
  });
  test('setBondLength moves the chosen side', () => {
    const w = water();
    const d = setBondLength(w, 0, 1.5, [1]);
    expect(w.atoms[0]!.position).toEqual(d.atoms[0]!.position);
    const [ox, hy] = [d.atoms[0]!.position, d.atoms[1]!.position];
    expect(Math.hypot(ox[0] - hy[0], ox[1] - hy[1], ox[2] - hy[2])).toBeCloseTo(1.5);
  });
  test('rotateAtoms about centroid keeps the centroid', () => {
    const w = water();
    const d = rotateAtoms(w, [0, 1, 2], [0, 0, 1], 1.0);
    const c = (s: StructureDoc) => s.atoms.reduce((acc, a) => acc + a.position[0], 0) / 3;
    expect(c(d)).toBeCloseTo(c(w));
  });
});

describe('selection', () => {
  test('atomsInRect handles inverted rectangles and nulls', () => {
    const pts = [{ x: 5, y: 5 }, { x: 50, y: 50 }, null];
    expect(atomsInRect({ x0: 10, y0: 10, x1: 0, y1: 0 }, pts)).toEqual([0]);
  });
  test('combine / invert / expand', () => {
    const w = water();
    expect([...combineSelection(new Set([0]), [0, 1], 'toggle')]).toEqual([1]);
    expect([...combineSelection(new Set([0]), [1], 'add')]).toEqual([0, 1]);
    expect([...combineSelection(new Set([0]), [1], 'replace')]).toEqual([1]);
    expect([...invertSelection(w, new Set([0]))]).toEqual([1, 2]);
    expect([...expandSelection(w, [1], 'molecules')].sort()).toEqual([0, 1, 2]);
    const withRes = {
      ...w,
      residues: [{ name: 'HOH', number: 1, chain: '', atom_indices: [0, 1] }],
    };
    expect([...expandSelection(withRes, [0], 'residues')]).toEqual([0, 1]);
    expect([...expandSelection(withRes, [2], 'residues')]).toEqual([2]);
  });
});

describe('measure', () => {
  test('distance, angle and dihedral', () => {
    const w = water();
    const m = measure(w, [1, 0, 2]);
    expect(m?.distances[0]).toBeCloseTo(0.9578, 3);
    expect(m?.angle).toBeCloseTo(104.5, 0);
    expect(m?.dihedral).toBeNull();
    expect(formatMeasurement(m)).toContain('angle = ');
    expect(measure(w, [0])).toBeNull();
    expect(measure(w, [0, 7])).toBeNull();
    const d = doc(
      [
        ['C', 1, 0, 0],
        ['C', 0, 0, 0],
        ['C', 0, 0, 1],
        ['C', 0, 1, 1],
      ],
      [],
    );
    expect(measure(d, [0, 1, 2, 3])?.dihedral).toBeCloseTo(90);
  });
});

test('perceiveBondsForAtom skips atoms that are already bonded, whatever the bond order', () => {
  const doc = normalizeStructure({
    name: 'chain',
    charge: 0,
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('C', [0, 1.5, 0])],
    bonds: [{ a: 1, b: 0, order: 2, aromatic: false }],
  });
  // atom 1 is bonded to 0 already (stored as a=1, b=0), atom 2 is in range and unbonded
  expect(perceiveBondsForAtom(doc, 0).map((b) => [b.a, b.b])).toEqual([[0, 2]]);
});
