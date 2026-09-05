/**
 * Persist the view store with the open project: load on open, save (debounced) on change.
 * Only plain, serializable settings are stored; transient fields (fitRequest) are skipped.
 */
import { api } from '../api/client';
import { useViewStore, type ViewState } from './viewStore';

const PERSISTED: (keyof ViewState)[] = ['style', 'projection', 'showHydrogens', 'background'];
const SAVE_DELAY_MS = 500;

export function pickPersisted(state: ViewState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED) out[key] = state[key];
  for (const key of Object.keys(state)) {
    // layers/extra toggles added by features (booleans and numbers only)
    const v = (state as unknown as Record<string, unknown>)[key];
    if ((typeof v === 'boolean' || typeof v === 'number') && key !== 'fitRequest') out[key] = v;
  }
  return out;
}

export function applyPersisted(settings: Record<string, unknown>): void {
  const patch: Record<string, unknown> = {};
  const current = useViewStore.getState() as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(settings)) {
    if (k in current && typeof current[k] !== 'function' && k !== 'fitRequest') patch[k] = v;
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
