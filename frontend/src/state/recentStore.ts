/**
 * The recently opened files (Avogadro's File ▸ Open Recent).
 *
 * The list lives in the backend, because it has to survive the browser as well as the project:
 * the backend records a path when it reads a structure from one, and this mirrors that list for
 * the menu.
 */
import { create } from 'zustand';
import { api, type RecentFile } from '../api/client';

export type { RecentFile };

interface RecentState {
  files: readonly RecentFile[];
  /** Read the list again; called on start-up and after anything that opens a file by path. */
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
}

export const useRecentStore = create<RecentState>((set) => ({
  files: [],
  refresh: async () => {
    try {
      set({ files: await api.io.recent() });
    } catch {
      // the menu simply has no recent files if the backend cannot say; not worth an error toast
    }
  },
  clear: async () => {
    try {
      set({ files: await api.io.clearRecent() });
    } catch {
      /* same */
    }
  },
}));
