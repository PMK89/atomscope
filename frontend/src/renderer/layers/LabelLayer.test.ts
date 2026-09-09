import { beforeAll, expect, test, vi } from 'vitest';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../../model/structure';
import { LabelLayer, MAX_LABELS } from './LabelLayer';
import type { LayerContext } from './Layer';

const water = (): StructureDoc =>
  normalizeStructure({
    name: 'water',
    atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [0, 0.8, 0.6]), makeAtom('H', [0, -0.8, 0.6])],
    bonds: [makeBond(0, 1), makeBond(0, 2)],
  } as never);

// jsdom has no 2D canvas; a stub is enough for the sprite geometry the layer places.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        measureText: (t: string) => ({ width: t.length * 24 }),
        fillText: () => {},
        set font(_v: string) {},
        set textAlign(_v: string) {},
        set textBaseline(_v: string) {},
        set fillStyle(_v: string) {},
      }) as unknown as CanvasRenderingContext2D,
  );
});

let revision = 0;
const ctx = (structure: StructureDoc, override?: Float32Array): LayerContext => ({
  structure,
  revision: ++revision,
  selectedAtoms: new Set<number>(),
  hoveredAtom: null,
  positionsOverride: override ?? null,
});

test('an invisible layer draws nothing', () => {
  const layer = new LabelLayer();
  layer.update(ctx(water()));
  expect(layer.labels()).toEqual([]);
  layer.dispose();
});

test('atom labels follow the settings and sit above their atoms', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.setSettings({ atoms: 'symbol_index' });
  layer.update(ctx(water()));

  expect(layer.labels()).toEqual(['O1', 'H2', 'H3']);
  const sprite = layer.object.children[0]!;
  // the label is lifted out of the sphere, and stays on the atom in x and z
  expect(sprite.position.x).toBeCloseTo(0);
  expect(sprite.position.y).toBeGreaterThan(0);
  expect(sprite.position.z).toBeCloseTo(0);
  layer.dispose();
});

test('bond labels are placed at the bond midpoint', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.setSettings({ atoms: 'none', bonds: 'length' });
  layer.update(ctx(water()));

  expect(layer.labels()).toEqual(['1.000', '1.000']);
  const sprite = layer.object.children[0]!;
  expect(sprite.position.y).toBeCloseTo(0.4);
  expect(sprite.position.z).toBeCloseTo(0.3);
  layer.dispose();
});

test('a trajectory frame moves the labels with the atoms', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.update(ctx(water()));
  const before = layer.object.children[0]!.position.x;

  layer.update(ctx(water(), new Float32Array([5, 0, 0, 0, 0.8, 0.6, 0, -0.8, 0.6])));
  expect(layer.object.children[0]!.position.x).toBeCloseTo(before + 5);
  layer.dispose();
});

test('a huge structure is truncated rather than drawn with a hundred thousand sprites', () => {
  const big = normalizeStructure({
    name: 'big',
    atoms: Array.from({ length: MAX_LABELS + 500 }, (_, i) => makeAtom('C', [i, 0, 0])),
    bonds: [],
  } as never);
  const layer = new LabelLayer();
  layer.visible = true;
  layer.update(ctx(big));

  expect(layer.labels()).toHaveLength(MAX_LABELS);
  expect(layer.truncated).toBe(true);
  layer.dispose();
});

test('hidden hydrogens keep no labels, and neither do the bonds to them', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.setSettings({ atoms: 'symbol_index', bonds: 'length', hideHydrogens: true });
  layer.update(ctx(water()));
  // only the oxygen is drawn, and both O-H bonds touch a hidden atom
  expect(layer.labels()).toEqual(['O1']);
  layer.dispose();
});

test('a bond length label is measured on the frame being displayed', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.setSettings({ atoms: 'none', bonds: 'length' });
  layer.update(ctx(water()));
  expect(layer.labels()).toEqual(['1.000', '1.000']);

  // stretch the first O-H in a displayed frame: the label must follow, not stay at equilibrium
  layer.update(ctx(water(), new Float32Array([0, 0, 0, 0, 1.6, 1.2, 0, -0.8, 0.6])));
  expect(layer.labels()).toEqual(['2.000', '1.000']);
  layer.dispose();
});

test('turning the layer off releases the sprites', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.update(ctx(water()));
  expect(layer.object.children.length).toBe(3);

  layer.visible = false;
  layer.update(ctx(water()));
  expect(layer.object.children.length).toBe(0);
  layer.dispose();
});

test('the bond labels have their own displacement, as Avogadro gives them', () => {
  // Avogadro carries xBondDispl/yBondDispl/zBondDispl beside the atom ones. Sharing one offset
  // means lifting an atom label clear of its sphere also lifts every bond label off its bond.
  const layer = new LabelLayer();
  layer.visible = true;
  layer.setSettings({ atoms: 'symbol', bonds: 'length' });
  layer.update(ctx(water()));
  const at = (label: string): { x: number; y: number; z: number } => {
    const i = layer.labels().indexOf(label);
    const p = layer.object.children[i]!.position;
    return { x: p.x, y: p.y, z: p.z };
  };
  const bondBefore = at('1.000');
  const atomBefore = at('O');

  layer.setSettings({ shift: [1, 0, 0], bondShift: [0, 0, 2] });
  layer.update(ctx(water()));
  // the atom label moved along x only, the bond label along z only
  expect(at('O').x).toBeCloseTo(atomBefore.x + 1);
  expect(at('O').z).toBeCloseTo(atomBefore.z);
  expect(at('1.000').z).toBeCloseTo(bondBefore.z + 2);
  expect(at('1.000').x).toBeCloseTo(bondBefore.x);
  layer.dispose();
});

test('the bond-length precision reaches the drawn label', () => {
  const layer = new LabelLayer();
  layer.visible = true;
  layer.setSettings({ atoms: 'none', bonds: 'length', lengthPrecision: 1 });
  layer.update(ctx(water()));
  expect(layer.labels()).toEqual(['1.0', '1.0']);
  layer.dispose();
});
