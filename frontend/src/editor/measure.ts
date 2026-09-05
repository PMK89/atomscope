/** Measurement of picked atoms: distances between consecutive picks, angle, dihedral. */
import { angleDeg, dihedralDeg, distance } from '../model/geometry';
import type { StructureDoc } from '../model/structure';

export interface Measurement {
  distances: number[];
  angle: number | null;
  dihedral: number | null;
}

export function measure(doc: StructureDoc, picks: readonly number[]): Measurement | null {
  const pts = picks.map((i) => doc.atoms[i]?.position);
  if (pts.some((p) => !p) || pts.length < 2) return null;
  const p = pts as NonNullable<(typeof pts)[number]>[];
  const distances: number[] = [];
  for (let i = 1; i < p.length; i++) distances.push(distance(p[i - 1]!, p[i]!));
  return {
    distances,
    angle: p.length >= 3 ? angleDeg(p[0]!, p[1]!, p[2]!) : null,
    dihedral: p.length >= 4 ? dihedralDeg(p[0]!, p[1]!, p[2]!, p[3]!) : null,
  };
}

export function formatMeasurement(m: Measurement | null): string {
  if (!m) return '';
  const parts = m.distances.map((d, i) => `d${i + 1}${i + 2} = ${d.toFixed(3)} Å`);
  if (m.angle !== null) parts.push(`angle = ${m.angle.toFixed(2)}°`);
  if (m.dihedral !== null) parts.push(`dihedral = ${m.dihedral.toFixed(2)}°`);
  return parts.join('   ');
}
