/**
 * Remember the tool settings between sessions (AV-UI-014, Avogadro's per-tool
 * readSettings/writeSettings).
 *
 * Only the knobs are stored. What a tool is doing *right now* -- the rubber band, the selected
 * bond, the atoms of a measurement, whether a run is going -- is state about the open document or
 * about a gesture in flight, and restoring it into a different structure would point at atoms that
 * are not there.
 */
import { useToolStore, type ToolSettings, type ToolState } from '../editor/toolStore';
import { TOOL_IDS, type ToolId } from '../editor/Tool';
import { readLocal, writeLocal } from './localSettings';

const KEY = 'tools';
const SAVE_DELAY_MS = 500;

/** The fields worth remembering, per tool. Everything not named here is transient. */
const KEPT: { [K in keyof ToolSettings]?: readonly (keyof ToolSettings[K])[] } = {
  draw: ['element', 'bondOrder', 'adjustHydrogens'],
  select: ['mode'],
  autoRotate: ['x', 'y', 'z'],
  autoOptimize: ['forceField', 'algorithm', 'steps'],
};

export interface StoredToolSettings {
  active?: ToolId;
  [tool: string]: unknown;
}

export function pickToolSettings(state: ToolState): StoredToolSettings {
  const out: StoredToolSettings = { active: state.active };
  for (const [tool, fields] of Object.entries(KEPT)) {
    const group = state[tool as keyof ToolSettings] as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const field of fields as readonly string[]) kept[field] = group[field];
    out[tool] = kept;
  }
  return out;
}

/** Apply what was stored, keeping the current value wherever the stored one is not of its shape. */
export function applyToolSettings(stored: StoredToolSettings): void {
  const current = useToolStore.getState();
  if (
    typeof stored.active === 'string' &&
    (TOOL_IDS as readonly string[]).includes(stored.active)
  ) {
    useToolStore.getState().setActive(stored.active);
  }
  for (const [tool, fields] of Object.entries(KEPT)) {
    const group = stored[tool];
    if (!group || typeof group !== 'object') continue;
    const now = current[tool as keyof ToolSettings] as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of fields as readonly string[]) {
      const value = (group as Record<string, unknown>)[field];
      // a value of another type is an older or hand-edited store, and would break a tool
      if (field in now && typeof value === typeof now[field]) patch[field] = value;
    }
    if (Object.keys(patch).length > 0) {
      useToolStore.getState().update(tool as keyof ToolSettings, patch as never);
    }
  }
}

/** Load once, then save (debounced) on every change. Returns a stop function. */
export function startToolSettingsSync(): () => void {
  applyToolSettings(readLocal<StoredToolSettings>(KEY, {}));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useToolStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => writeLocal(KEY, pickToolSettings(state)), SAVE_DELAY_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
