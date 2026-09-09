import { describe, expect, it, test } from 'vitest';
import { dot } from './geometry';
import {
  SAMPLES_PER_RESIDUE,
  catmullRom,
  chainFrames,
  sideVectors,
  stripGeometry,
  type GuideResidue,
  withNitrogens,
} from './ribbon';
import type { Vec3 } from './structure';

/** A straight chain whose carbonyls alternate, the way a beta strand's do. */
const strand = (n: number, kind: GuideResidue['kind'] = 'sheet'): GuideResidue[] =>
  Array.from({ length: n }, (_, i) => ({
    ca: [i * 3.3, 0, 0] as Vec3,
    o: [i * 3.3, i % 2 === 0 ? 1.2 : -1.2, 0] as Vec3,
    kind,
  }));

test('the spline passes through its control points', () => {
  const p: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 1, 0],
    [3, 1, 0],
  ];
  expect(catmullRom(p[0]!, p[1]!, p[2]!, p[3]!, 0)).toEqual(p[1]);
  const end = catmullRom(p[0]!, p[1]!, p[2]!, p[3]!, 1);
  expect(end[0]).toBeCloseTo(2);
  expect(end[1]).toBeCloseTo(1);
});

test('alternating carbonyls do not make the ribbon twist', () => {
  const sides = sideVectors(strand(6));
  for (let i = 1; i < sides.length; i++) {
    // without the sign fix every second one would point the opposite way
    expect(dot(sides[i]!, sides[i - 1]!)).toBeGreaterThan(0);
  }
});

test('side vectors are perpendicular to the backbone', () => {
  const residues = strand(4);
  for (const s of sideVectors(residues)) expect(Math.abs(s[0]!)).toBeLessThan(1e-6);
});

test('frames are sampled along the chain and carry the secondary structure', () => {
  const frames = chainFrames(strand(4, 'helix'), 'cartoon');
  expect(frames).toHaveLength(3 * SAMPLES_PER_RESIDUE + 1);
  expect(frames.every((f) => f.kind === 'helix')).toBe(true);
  // the frame is orthonormal: side, tangent and up are mutually perpendicular
  const f = frames[5]!;
  expect(dot(f.side, f.tangent)).toBeCloseTo(0);
  expect(dot(f.up, f.tangent)).toBeCloseTo(0);
});

test('a strand ends in an arrowhead, a helix does not', () => {
  const mixed: GuideResidue[] = [
    ...strand(3, 'sheet'),
    { ca: [9.9, 0, 0], o: [9.9, 1.2, 0], kind: 'coil' },
  ];
  const widths = chainFrames(mixed, 'cartoon')
    .filter((f) => f.kind === 'sheet')
    .map((f) => f.width);
  // the last strand residue tapers; the ones before it keep their width
  expect(widths.at(-1)!).toBeLessThan(widths[0]!);
  expect(widths[0]).toBeCloseTo(widths[1]!);

  const helix = chainFrames(strand(4, 'helix'), 'cartoon').map((f) => f.width);
  expect(new Set(helix.map((w) => w.toFixed(3))).size).toBe(1);
});

test('a short chain has no ribbon at all', () => {
  expect(chainFrames(strand(1), 'ribbon')).toEqual([]);
});

test('two chains are two strips with no triangle between them', () => {
  const a = chainFrames(strand(3), 'ribbon');
  const b = chainFrames(strand(3), 'ribbon');
  const geometry = stripGeometry([a, b]);

  expect(geometry.positions.length / 3).toBe(4 * a.length); // two vertices per frame, two chains
  expect(geometry.colors.length).toBe(geometry.positions.length);
  // each strip has (frames - 1) quads; nothing joins the last vertex of one to the first of the next
  expect(geometry.indices.length).toBe(2 * (a.length - 1) * 6);
  const half = geometry.positions.length / 3 / 2;
  expect(Math.max(...geometry.indices.slice(0, (a.length - 1) * 6))).toBeLessThan(half);
});

describe('withNitrogens', () => {
  it('adds each backbone nitrogen before its own alpha carbon', () => {
    const residues: GuideResidue[] = [
      { ca: [1, 0, 0], o: [1, 1, 0], n: [0.5, 0, 0], kind: 'helix' },
      { ca: [4, 0, 0], o: [4, 1, 0], n: [3.5, 0, 0], kind: 'sheet' },
    ];
    const out = withNitrogens(residues);
    // two guide points per residue, the nitrogen first: N-CA is the backbone order
    expect(out.map((r) => r.ca)).toEqual([
      [0.5, 0, 0],
      [1, 0, 0],
      [3.5, 0, 0],
      [4, 0, 0],
    ]);
    // each nitrogen point carries its own residue's kind and orienting oxygen, so the widths,
    // the colours and the sheet arrowhead all keep working on the longer list
    expect(out.map((r) => r.kind)).toEqual(['helix', 'helix', 'sheet', 'sheet']);
    expect(out[2]!.o).toEqual([4, 1, 0]);
  });

  it('leaves a residue with no nitrogen alone', () => {
    const residues: GuideResidue[] = [
      { ca: [1, 0, 0], o: [1, 1, 0], kind: 'coil' },
      { ca: [4, 0, 0], o: [4, 1, 0], n: [3.5, 0, 0], kind: 'coil' },
    ];
    // a deleted or hidden nitrogen is not a broken chain, only one fewer guide point
    expect(withNitrogens(residues)).toHaveLength(3);
  });

  it('makes the spline follow the backbone more closely', () => {
    // a kinked chain: through the alpha carbons alone the curve cuts the corner; through the
    // nitrogens as well it stays nearer the backbone it is drawn for
    const kinked: GuideResidue[] = [
      { ca: [0, 0, 0], o: [0, 1, 0], n: [-0.5, 0, 0], kind: 'coil' },
      { ca: [3, 0, 0], o: [3, 1, 0], n: [2.5, 0, 0], kind: 'coil' },
      { ca: [3, 3, 0], o: [4, 3, 0], n: [3, 2.5, 0], kind: 'coil' },
      { ca: [6, 3, 0], o: [6, 4, 0], n: [5.5, 3, 0], kind: 'coil' },
    ];
    const plain = chainFrames(kinked, 'backbone');
    const withN = chainFrames(withNitrogens(kinked), 'backbone');
    expect(withN.length).toBeGreaterThan(plain.length);
    // the corner at (3,0) is where cutting shows: measure how near each curve gets to it
    const nearest = (frames: ReturnType<typeof chainFrames>): number =>
      Math.min(...frames.map((f) => Math.hypot(f.center[0] - 3, f.center[1] - 0)));
    expect(nearest(withN)).toBeLessThanOrEqual(nearest(plain) + 1e-9);
  });
});
