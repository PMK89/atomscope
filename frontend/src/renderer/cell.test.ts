import { cellEdgeCount, cellEdgePositions, type Mat3 } from './cell';
import type { LayerContext } from './layers/Layer';
import { UnitCellLayer } from './layers/UnitCellLayer';
import { VectorLayer } from './layers/VectorLayer';
import { emptyStructure, makeAtom } from '../model/structure';

const cubic: Mat3 = [
  [2, 0, 0],
  [0, 3, 0],
  [0, 0, 4],
];

function edgeLengths(buf: Float32Array): number[] {
  const out: number[] = [];
  for (let e = 0; e < buf.length; e += 6) {
    const dx = buf[e + 3]! - buf[e]!;
    const dy = buf[e + 4]! - buf[e + 1]!;
    const dz = buf[e + 5]! - buf[e + 2]!;
    out.push(Math.hypot(dx, dy, dz));
  }
  return out;
}

test('one cell has 12 edges, four along each lattice vector', () => {
  const buf = cellEdgePositions(cubic);
  expect(buf.length).toBe(12 * 2 * 3);
  const lengths = edgeLengths(buf).map((l) => Math.round(l));
  expect(lengths.filter((l) => l === 2)).toHaveLength(4);
  expect(lengths.filter((l) => l === 3)).toHaveLength(4);
  expect(lengths.filter((l) => l === 4)).toHaveLength(4);
  // every corner of the box appears
  const xs = new Set<number>();
  for (let i = 0; i < buf.length; i += 3) xs.add(buf[i]!);
  expect([...xs].sort()).toEqual([0, 2]);
});

test('replication draws every image cell', () => {
  const buf = cellEdgePositions(cubic, [2, 1, 3]);
  expect(cellEdgeCount([2, 1, 3])).toBe(72);
  expect(buf.length).toBe(72 * 6);
  let maxX = 0;
  let maxZ = 0;
  for (let i = 0; i < buf.length; i += 3) {
    maxX = Math.max(maxX, buf[i]!);
    maxZ = Math.max(maxZ, buf[i + 2]!);
  }
  expect(maxX).toBe(4);
  expect(maxZ).toBe(12);
  expect(cellEdgeCount([0, 1, 1])).toBe(12); // counts below 1 are clamped
});

test('triclinic edges follow the lattice vectors', () => {
  const tri: Mat3 = [
    [1, 0, 0],
    [0.5, 1, 0],
    [0.2, 0.3, 1],
  ];
  const lengths = edgeLengths(cellEdgePositions(tri));
  expect(lengths.filter((l) => Math.abs(l - Math.hypot(0.5, 1)) < 1e-6)).toHaveLength(4);
});

const ctx = (overrides: Partial<LayerContext> & Pick<LayerContext, 'structure'>): LayerContext => ({
  revision: 1,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
  ...overrides,
});

test('UnitCellLayer draws the structure cell, prefers the frame override, clears without cell', () => {
  const layer = new UnitCellLayer({ showLabels: false });
  const doc = {
    ...emptyStructure(),
    cell: { vectors: cubic, pbc: [true, true, true] as [boolean, boolean, boolean] },
  };
  layer.update(ctx({ structure: doc }));
  expect(layer.edgeCount).toBe(12);
  layer.setSettings({ repeat: [2, 2, 2] });
  layer.update(ctx({ structure: doc }));
  expect(layer.edgeCount).toBe(96);
  layer.update(ctx({ structure: emptyStructure() }));
  expect(layer.edgeCount).toBe(0);
  layer.update(ctx({ structure: emptyStructure(), cellOverride: cubic }));
  expect(layer.edgeCount).toBe(96);
  layer.dispose();
});

test('VectorLayer draws one arrow per atom vector above the cutoff, at override positions', () => {
  const layer = new VectorLayer({ minLength: 0.1 });
  const doc = {
    ...emptyStructure(),
    atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [1, 0, 0]), makeAtom('H', [2, 0, 0])],
    atomic_vectors: {
      forces: {
        values: [
          [0, 0, 1],
          [0, 0.01, 0],
          [2, 0, 0],
        ] as [number, number, number][],
        unit: 'eV/angstrom' as never,
        description: '',
      },
    },
  };
  layer.update(ctx({ structure: doc }));
  expect(layer.count).toBe(2);
  layer.setSettings({ scale: 20 });
  layer.update(ctx({ structure: doc }));
  expect(layer.count).toBe(3);
  layer.setSettings({ field: 'velocities' });
  layer.update(ctx({ structure: doc }));
  expect(layer.count).toBe(0);
  layer.setSettings({ field: 'forces' });
  layer.update(ctx({ structure: doc, positionsOverride: new Float32Array(9) }));
  expect(layer.count).toBe(3);
  layer.dispose();
});
