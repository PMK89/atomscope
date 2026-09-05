import { expect, test } from 'vitest';
import { removeAtoms } from '../editor/edits';
import { elementBySymbol } from '../model/elements';
import { makeAtom, makeBond, normalizeStructure, type StructureDoc } from '../model/structure';
import {
  assignAtomColor,
  assignedColorCount,
  atomColorArray,
  atomColors,
  NO_ATOM_COLORS,
} from './atomColors';

const doc = (): StructureDoc =>
  normalizeStructure({
    name: 'c3',
    atoms: [
      makeAtom('C', [0, 0, 0]),
      makeAtom('C', [1.5, 0, 0]),
      makeAtom('O', [3, 0, 0]),
      makeAtom('H', [4, 0, 0]),
    ],
    bonds: [makeBond(0, 1), makeBond(1, 2), makeBond(2, 3)],
  });

const rgb = (a: Float32Array, i: number): number[] => [...a.slice(3 * i, 3 * i + 3)];

test('nothing assigned hands the array back untouched, identity included', () => {
  const d = doc();
  expect(atomColorArray(null, d, NO_ATOM_COLORS)).toBeNull();
  const scheme = atomColors([], d.atoms.length, 'custom', null, { custom: '#123456' })!;
  expect(atomColorArray(scheme, d, NO_ATOM_COLORS)).toBe(scheme);
  // an assignment made against another document reaches no atom of this one
  const other = assignAtomColor(NO_ATOM_COLORS, doc(), [0], '#ff0000');
  expect(atomColorArray(scheme, d, other)).toBe(scheme);
});

test('an assigned atom is painted over the element colours, the others are not', () => {
  const d = doc();
  const a = assignAtomColor(NO_ATOM_COLORS, d, [2], '#ff8000');
  const out = atomColorArray(null, d, a)!;
  expect(rgb(out, 2).map((v) => Math.round(v * 255))).toEqual([255, 128, 0]);
  // atom 3 keeps hydrogen's own colour rather than falling to the unknown grey
  const h = elementBySymbol('H').color;
  expect(rgb(out, 3)).toEqual([h[0], h[1], h[2]]);
  expect(assignedColorCount(d, a)).toBe(1);
});

test('an assigned atom is painted over a scheme, and cleared atoms fall back to it', () => {
  const d = doc();
  const scheme = atomColors([], d.atoms.length, 'custom', null, { custom: '#0000ff' })!;
  const a = assignAtomColor(NO_ATOM_COLORS, d, [0, 1], '#00ff00');
  const out = atomColorArray(scheme, d, a)!;
  expect(rgb(out, 0)).toEqual([0, 1, 0]);
  expect(rgb(out, 2)).toEqual([0, 0, 1]);
  expect(out).not.toBe(scheme);

  const cleared = assignAtomColor(a, d, [0], null);
  expect(rgb(atomColorArray(scheme, d, cleared)!, 0)).toEqual([0, 0, 1]);
  expect(assignedColorCount(d, cleared)).toBe(1);
});

test('a colour follows its atom through a deletion, because it is keyed by uid', () => {
  const d = doc();
  const a = assignAtomColor(NO_ATOM_COLORS, d, [2], '#ff8000');
  // drop atom 0: the oxygen becomes index 1, and must keep its colour rather than hand it on
  const after = removeAtoms(d, new Set([0]));
  const out = atomColorArray(null, after, a)!;
  expect(rgb(out, 1).map((v) => Math.round(v * 255))).toEqual([255, 128, 0]);
  expect(assignedColorCount(after, a)).toBe(1);
  // the carbon that is left keeps its element colour, to float32 precision
  const c = elementBySymbol('C').color;
  rgb(out, 0).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
});
