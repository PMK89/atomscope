import { expect, test } from 'vitest';
import {
  colorsFromValues,
  divergingColor,
  makeSampler,
  sampleAtVertices,
  symmetricRange,
} from './gridSampling';
import type { GridGeometry } from './marchingCubes';

/** 2x2x2 grid over the unit cube, value = x index (so it ramps along x only). */
const geometry: GridGeometry = {
  shape: [2, 2, 2],
  origin: [0, 0, 0],
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};
const values = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]);

test('sampling interpolates between the corners', () => {
  const sample = makeSampler(values, geometry);
  expect(sample(0, 0, 0)).toBeCloseTo(0);
  expect(sample(1, 0, 0)).toBeCloseTo(1);
  expect(sample(0.25, 0.5, 0.75)).toBeCloseTo(0.25);
});

test('a point outside the grid takes the value at the edge, not a wrapped one', () => {
  const sample = makeSampler(values, geometry);
  expect(sample(-5, 0, 0)).toBeCloseTo(0);
  expect(sample(5, 0.5, 0.5)).toBeCloseTo(1);
});

test('a skewed grid is sampled in its own coordinates', () => {
  const skewed: GridGeometry = {
    shape: [2, 2, 2],
    origin: [1, 0, 0],
    axes: [
      [2, 0, 0],
      [1, 2, 0],
      [0, 0, 1],
    ],
  };
  const sample = makeSampler(values, skewed);
  // one full step along the first axis is +2 in x from the origin
  expect(sample(3, 0, 0)).toBeCloseTo(1);
  // a step along the second axis moves in x too, and must not be read as a step along the first
  expect(sample(2, 2, 0)).toBeCloseTo(0);
});

test('the colour scale runs blue through white to red', () => {
  expect(divergingColor(0)).toEqual([0, 0, 1]);
  expect(divergingColor(0.5)).toEqual([1, 1, 1]);
  expect(divergingColor(1)).toEqual([1, 0, 0]);
  // out of range is clamped rather than wrapped
  expect(divergingColor(-3)).toEqual([0, 0, 1]);
  expect(divergingColor(7)).toEqual([1, 0, 0]);
});

test('vertex values carry their range, and colours follow it', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 0, 0]);
  const { values: sampled, min, max } = sampleAtVertices(positions, makeSampler(values, geometry));
  expect([...sampled].map((v) => Number(v.toFixed(3)))).toEqual([0, 1, 0.5]);
  expect(min).toBeCloseTo(0);
  expect(max).toBeCloseTo(1);

  const colors = colorsFromValues(sampled, min, max);
  expect([...colors.slice(0, 3)]).toEqual([0, 0, 1]);
  expect([...colors.slice(6, 9)]).toEqual([1, 1, 1]);
});

test('a flat field gets the middle of the scale, not a division by zero', () => {
  const colors = colorsFromValues(new Float32Array([2, 2]), 2, 2);
  expect([...colors]).toEqual([1, 1, 1, 1, 1, 1]);
});

test('an automatic scale is symmetric about zero, so white means zero', () => {
  expect(symmetricRange(-2, 1)).toEqual([-2, 2]);
  expect(symmetricRange(0.5, 3)).toEqual([-3, 3]);

  const [low, high] = symmetricRange(-2, 1);
  const colors = colorsFromValues(new Float32Array([-2, 0, 1]), low, high);
  expect([...colors.slice(0, 3)]).toEqual([0, 0, 1]);
  expect([...colors.slice(3, 6)]).toEqual([1, 1, 1]);
});
