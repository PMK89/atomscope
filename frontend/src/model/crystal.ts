/**
 * Pure crystallography helpers for the Crystal panel: cell parameters, fractional <-> Cartesian
 * conversion and the text grammars of the matrix and fractional-coordinate editors.
 */
import { parseCartesian, type ParsedLine } from '../editor/cartesian';
import { cross, dot, invert3, length, mulRow, type Mat3 } from './geometry';
import type { Cell, StructureDoc, Vec3 } from './structure';

export { invert3 };
export type { Mat3 };

export interface CellParameters {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export type LatticeType =
  | 'triclinic'
  | 'monoclinic'
  | 'orthorhombic'
  | 'tetragonal'
  | 'rhombohedral'
  | 'hexagonal'
  | 'cubic';

const deg = (rad: number): number => (rad * 180) / Math.PI;

function angleBetween(u: Vec3, v: Vec3): number {
  const c = dot(u, v) / (length(u) * length(v));
  return deg(Math.acos(Math.max(-1, Math.min(1, c))));
}

export function cellParameters(cell: Cell): CellParameters {
  const [va, vb, vc] = cell.vectors as Mat3;
  return {
    a: length(va),
    b: length(vb),
    c: length(vc),
    alpha: angleBetween(vb, vc),
    beta: angleBetween(va, vc),
    gamma: angleBetween(va, vb),
  };
}

export function cellVolume(cell: Cell): number {
  const [va, vb, vc] = cell.vectors as Mat3;
  return Math.abs(dot(va, cross(vb, vc)));
}

export function fracToCart(frac: Vec3, cell: Cell): Vec3 {
  return mulRow(frac, cell.vectors as Mat3);
}

export function cartToFrac(cart: Vec3, cell: Cell): Vec3 {
  return mulRow(cart, invert3(cell.vectors as Mat3));
}

/** Lattice classification from lengths/angles only (display hint; spglib gives the real answer). */
export function latticeTypeFromParameters(p: CellParameters, tol = 1e-3): LatticeType {
  const eq = (x: number, y: number): boolean => Math.abs(x - y) <= tol * Math.max(1, Math.abs(x));
  const right = [p.alpha, p.beta, p.gamma].map((x) => eq(x, 90));
  const nEqual = [eq(p.a, p.b), eq(p.b, p.c), eq(p.a, p.c)].filter(Boolean).length;
  if (right.every(Boolean)) {
    if (nEqual === 3) return 'cubic';
    return nEqual === 1 ? 'tetragonal' : 'orthorhombic';
  }
  if (eq(p.a, p.b) && right[0] && right[1] && eq(p.gamma, 120)) return 'hexagonal';
  if (nEqual === 3 && eq(p.alpha, p.beta) && eq(p.beta, p.gamma)) return 'rhombohedral';
  return right.filter(Boolean).length === 2 ? 'monoclinic' : 'triclinic';
}

// ---- text editors ----------------------------------------------------------------------------

export function formatMatrix(m: Mat3, digits = 5): string {
  return m.map((row) => row.map((x) => x.toFixed(digits).padStart(12)).join(' ')).join('\n');
}

/** Parse three rows of three numbers (whitespace/comma separated); blank lines are skipped. */
export function parseMatrix(text: string): Mat3 {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rows.length !== 3) throw new Error(`expected 3 rows, got ${rows.length}`);
  const out = rows.map((row, i) => {
    const nums = row.split(/[\s,;]+/).map(Number);
    if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n)))
      throw new Error(`row ${i + 1}: expected 3 numbers`);
    return nums as Vec3;
  });
  return out as Mat3;
}

/** One line per atom ("El fx fy fz"); empty without a cell or for a singular cell. */
export function formatFractional(doc: StructureDoc, digits = 5): string {
  if (!doc.cell) return '';
  let inv: Mat3;
  try {
    inv = invert3(doc.cell.vectors as Mat3);
  } catch {
    return '';
  }
  return doc.atoms
    .map((a) => {
      const f = mulRow(a.position, inv);
      return `${a.element.padEnd(2)} ${f.map((x) => x.toFixed(digits).padStart(10)).join(' ')}`;
    })
    .join('\n');
}

/** Parse "El fx fy fz" lines and convert to Cartesian lines for `applyCartesian`. */
export function parseFractional(text: string, cell: Cell): ParsedLine[] {
  return parseCartesian(text).map((l) => ({ ...l, position: fracToCart(l.position, cell) }));
}

/** Parse "a b c" integers (>= 1) for supercell repeats or view repeats. */
export function parseRepeat(values: [string, string, string]): [number, number, number] {
  const nums = values.map((v) => Number(v.trim()));
  if (nums.some((n) => !Number.isInteger(n) || n < 1))
    throw new Error('repeats must be integers >= 1');
  return nums as [number, number, number];
}

/** Parse Miller indices "h k l" (integers, not all zero). */
export function parseMiller(text: string): [number, number, number] {
  const nums = text
    .trim()
    .split(/[\s,;]+/)
    .map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isInteger(n)))
    throw new Error('expected three integers h k l');
  if (nums.every((n) => n === 0)) throw new Error('Miller indices must not all be zero');
  return nums as [number, number, number];
}
