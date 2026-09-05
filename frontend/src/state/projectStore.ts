import { create } from 'zustand';
import { api, type ProjectInfo, type StructureSummary } from '../api/client';

interface ProjectState {
  info: ProjectInfo | null;
  structures: StructureSummary[];
  refresh: () => Promise<void>;
  open: (path: string) => Promise<void>;
  create: (path: string, name: string) => Promise<void>;
  close: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  info: null,
  structures: [],
  refresh: async () => {
    const info = await api.project.current();
    const structures = info ? await api.structures.list() : [];
    set({ info, structures });
  },
  open: async (path) => {
    const info = await api.project.open({ path });
    set({ info, structures: await api.structures.list() });
  },
  create: async (path, name) => {
    const info = await api.project.create({ path, name });
    set({ info, structures: [] });
  },
  close: async () => {
    await api.project.close();
    set({ info: null, structures: [] });
  },
}));
