import { expect, test } from 'vitest';
import { backgroundHex } from './viewStore';

test('a chosen background wins over the preset, and nonsense falls back to it', () => {
  expect(backgroundHex({ background: 'black', backgroundColor: '' })).toBe(0x000000);
  expect(backgroundHex({ background: 'black', backgroundColor: '#ff8000' })).toBe(0xff8000);
  // a hand-edited project file must not paint the viewport with NaN
  expect(backgroundHex({ background: 'gray', backgroundColor: 'red' })).toBe(0x3a3d42);
  expect(backgroundHex({ background: 'gray', backgroundColor: '#abc' })).toBe(0x3a3d42);
});
