import { expect, test } from 'vitest';
import type { FormatDescription } from '../api/client';
import {
  defaultFormat,
  extensionOf,
  formatForPath,
  pathForFormat,
  writableFormats,
} from './exportFormats';

const f = (
  name: string,
  extensions: string[],
  can_write = true,
  library = 'ase',
): FormatDescription => ({
  name,
  extensions,
  description: name,
  can_read: true,
  can_write,
  library,
});

const FORMATS: FormatDescription[] = [
  f('xyz', ['xyz']),
  f('extxyz', ['extxyz', 'xyz']),
  f('cif', ['cif']),
  f('pdb', ['pdb', 'ent']),
  f('cml', ['cml'], true, 'openbabel'),
  f('gaussian-out', ['log', 'out'], false),
];

test('only the formats that can be written are offered', () => {
  expect(writableFormats(FORMATS).map((x) => x.name)).toEqual([
    'xyz',
    'extxyz',
    'cif',
    'pdb',
    'cml',
  ]);
});

test('the extension names the format, and the chosen format wins a shared extension', () => {
  expect(extensionOf('/tmp/a/water.CIF')).toBe('cif');
  expect(extensionOf('/tmp/a/water')).toBe('');
  expect(extensionOf('.bashrc')).toBe('');

  expect(formatForPath(FORMATS, '/tmp/water.cif')).toBe('cif');
  expect(formatForPath(FORMATS, '/tmp/water.ent')).toBe('pdb');
  // .xyz is claimed by both writers: the one already chosen keeps it
  expect(formatForPath(FORMATS, '/tmp/water.xyz')).toBe('xyz');
  expect(formatForPath(FORMATS, '/tmp/water.xyz', 'extxyz')).toBe('extxyz');
  // a read-only format never claims one, and an unknown extension names nothing
  expect(formatForPath(FORMATS, '/tmp/run.log')).toBeNull();
  expect(formatForPath(FORMATS, '/tmp/water.zzz')).toBeNull();
  expect(formatForPath(FORMATS, '/tmp/water')).toBeNull();
});

test('choosing a format renames the file to match', () => {
  expect(pathForFormat(FORMATS, '/tmp/water.xyz', 'cif')).toBe('/tmp/water.cif');
  expect(pathForFormat(FORMATS, '/tmp/water', 'cif')).toBe('/tmp/water.cif');
  // the first extension of the format is the one written
  expect(pathForFormat(FORMATS, '/tmp/water.xyz', 'pdb')).toBe('/tmp/water.pdb');
  // a directory or an empty path has no name to rename
  expect(pathForFormat(FORMATS, '/tmp/', 'cif')).toBe('/tmp/');
  expect(pathForFormat(FORMATS, '', 'cif')).toBe('');
  // a dot in the directory is not the file's extension
  expect(pathForFormat(FORMATS, '/tmp/v1.2/water', 'cif')).toBe('/tmp/v1.2/water.cif');
});

test('the default format is where the structure came from, else CML', () => {
  expect(defaultFormat(FORMATS, 'cif')).toBe('cif');
  expect(defaultFormat(FORMATS, null)).toBe('cml');
  // a structure read from a format nothing can write falls back too
  expect(defaultFormat(FORMATS, 'gaussian-out')).toBe('cml');
  expect(defaultFormat([f('xyz', ['xyz'])], null)).toBe('xyz');
});
