/**
 * Persist the view store with the open project: load on open, save (debounced) on change.
 * Only plain, serializable settings are stored; transient fields (fitRequest) are skipped.
 */
import { api } from '../api/client';
import { useViewStore, type ViewState } from './viewStore';

const SAVE_DELAY_MS = 500;

/**
 * A setting is anything serializable: a boolean, number or string, a tuple of numbers, or null --
 * null is how a nullable setting (selectionStyle) says "off", so it has to be stored as well.
 */
function isSetting(v: unknown): boolean {
  if (Array.isArray(v)) return v.every((x) => typeof x === 'number');
  return v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string';
}

/** Two values have the same shape when one can replace the other in the store. */
function sameShape(a: unknown, b: unknown): boolean {
  // null belongs to the nullable settings only (a style that is off), never to a tuple
  if (b === null) return a === null || typeof a === 'string';
  if (a === null) return typeof b === 'string';
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length;
  return typeof a === typeof b;
}

/** Counters that ask the renderer to do something once; they are not settings. */
const TRANSIENT = new Set(['fitRequest', 'centerRequest']);

export function pickPersisted(state: ViewState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(state)) {
    // strings and tuples count: a label content, a colour and a cell repeat are settings too
    if (!TRANSIENT.has(key) && isSetting(v)) out[key] = v;
  }
  return out;
}

export function applyPersisted(settings: Record<string, unknown>): void {
  const patch: Record<string, unknown> = {};
  const current = useViewStore.getState() as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(settings)) {
    // a stored value of the wrong shape (an older or hand-edited file) would break the renderer
    if (k in current && !TRANSIENT.has(k) && isSetting(v) && sameShape(current[k], v)) patch[k] = v;
  }
  // `atomScale` used to be a fraction of the *covalent* radius, before the ball-and-stick engine
  // gained Avogadro's radius basis and defaulted it to van der Waals. A project stored by such a
  // build carries the number but not the basis, and reading it on the new default would silently
  // draw every atom about twice the size it was saved at -- so the missing basis means the old
  // one. New projects store `radiusBasis` and are unaffected.
  if (('atomScale' in patch || 'bondRadius' in patch) && !('radiusBasis' in settings)) {
    patch['radiusBasis'] = 'covalent';
  }
  useViewStore.setState(patch as Partial<ViewState>);
}

/** Start syncing; returns a stop function. */
export function startViewSettingsSync(onError: (m: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loaded = false;
  api.project
    .getViewSettings()
    .then((s) => {
      applyPersisted(s);
      loaded = true;
    })
    .catch((e: Error) => onError(e.message));
  const unsubscribe = useViewStore.subscribe((state) => {
    if (!loaded) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      api.project.putViewSettings(pickPersisted(state)).catch(() => undefined);
    }, SAVE_DELAY_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
