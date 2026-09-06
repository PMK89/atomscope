/**
 * Which contributions are switched off (AV-PLUG-001, Avogadro's Plugin Manager).
 *
 * A store rather than a field on the registry: the registry is a stable object components close
 * over, so a flag on it would change nothing React can see. The registry stays the full list --
 * the manager needs to show what is off as well as what is on -- and every consumer filters
 * against this. Which plugins a person has switched off is theirs rather than the project's, so
 * it lives beside the tool settings and the open dock tab (`localSettings.ts`).
 *
 * Avogadro's own switch took effect at once rather than at the next start (`saveValues` emits
 * `reloadPlugins`, mainwindow.cpp:788), and so does this one.
 */
import { create } from 'zustand';
import type { PluginKind } from '../plugins/registry';
import { readLocal, writeLocal } from './localSettings';

const KEY = 'plugins.disabled';

export const pluginKey = (kind: PluginKind, id: string): string => `${kind}:${id}`;

interface PluginState {
  disabled: ReadonlySet<string>;
  isEnabled: (kind: PluginKind, id: string) => boolean;
  setEnabled: (kind: PluginKind, id: string, enabled: boolean) => void;
}

const stored = (): ReadonlySet<string> => {
  const raw = readLocal<unknown>(KEY, []);
  return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
};

export const usePluginStore = create<PluginState>((set, get) => ({
  disabled: stored(),
  isEnabled: (kind, id) => !get().disabled.has(pluginKey(kind, id)),
  setEnabled: (kind, id, enabled) => {
    const next = new Set(get().disabled);
    if (enabled) next.delete(pluginKey(kind, id));
    else next.add(pluginKey(kind, id));
    writeLocal(KEY, [...next]);
    set({ disabled: next });
  },
}));
