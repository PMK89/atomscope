/** Client-side helpers mirroring atomscope.schemas.engine (visibility and defaults). */
import type { ParameterSchema, ParameterSpec, ParameterValues } from '../api/client';

export function isVisible(spec: ParameterSpec, values: ParameterValues): boolean {
  for (const cond of spec.visible_when ?? []) {
    const actual = values[cond.key];
    const v = cond.value as unknown;
    let ok: boolean;
    switch (cond.op ?? 'eq') {
      case 'eq':
        ok = actual === v;
        break;
      case 'ne':
        ok = actual !== v;
        break;
      case 'in':
        ok = Array.isArray(v) && (v as unknown[]).includes(actual);
        break;
      case 'not_in':
        ok = !(Array.isArray(v) && (v as unknown[]).includes(actual));
        break;
      case 'truthy':
        ok = Boolean(actual);
        break;
      case 'falsy':
        ok = !actual;
        break;
      default:
        ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

export function schemaDefaults(schema: ParameterSchema): ParameterValues {
  const out: ParameterValues = {};
  for (const section of schema.sections)
    for (const p of section.parameters ?? []) if (p.default != null) out[p.key] = p.default;
  return out;
}

export function allSpecs(schema: ParameterSchema): ParameterSpec[] {
  return schema.sections.flatMap((s) => s.parameters ?? []);
}
