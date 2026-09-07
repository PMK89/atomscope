import { expect, test } from 'vitest';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { coopsForBonds } from './coopRequests';

const water = normalizeStructure({
  name: 'water',
  atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [1, 0, 0]), makeAtom('H', [0, 1, 0])],
  bonds: [makeBond(0, 1), makeBond(0, 2)],
} as never);

test('a bond becomes a hybrid on the heavy atom against hydrogen s, as the tutorial does', () => {
  const [coop] = coopsForBonds(water, new Set([0]));
  expect(coop).toEqual({
    id: 'coop-O1-H2',
    label: 'O1 sp3 – H2 s',
    first: { atom: 0, type: 'SP3', toward: 1 },
    second: { atom: 1, type: 'S', toward: 0 },
  });
});

test('each orbital points at the other atom, which is what makes the frame local', () => {
  const coops = coopsForBonds(water, new Set([0, 1]));
  expect(coops.map((c) => c.id)).toEqual(['coop-O1-H2', 'coop-O1-H3']);
  expect(coops[1]!.first.toward).toBe(2);
  expect(coops[1]!.second.toward).toBe(0);
});

test('the id is safe to use as a file name, because it becomes one', () => {
  for (const c of coopsForBonds(water, new Set([0, 1]))) {
    expect(c.id).toMatch(/^[A-Za-z0-9_.-]+$/);
  }
});

test('no bonds selected, nothing requested; a bond index that is not there is ignored', () => {
  expect(coopsForBonds(water, new Set())).toEqual([]);
  expect(coopsForBonds(water, new Set([99]))).toEqual([]);
});

test('two heavy atoms get a hybrid each', () => {
  const ethane = normalizeStructure({
    name: 'C-C',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0])],
    bonds: [makeBond(0, 1)],
  } as never);
  const [coop] = coopsForBonds(ethane, new Set([0]));
  expect([coop!.first.type, coop!.second.type]).toEqual(['SP3', 'SP3']);
});
