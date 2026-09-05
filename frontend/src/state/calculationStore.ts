/** Calculations of the open project, live job events, and the currently edited calculation. */
import { create } from 'zustand';
import { api, type Calculation, type ParameterSchema } from '../api/client';

export interface LogLine {
  stream: string;
  line: string;
}

interface CalculationState {
  calculations: Calculation[];
  schemas: Record<string, ParameterSchema>;
  selectedId: string | null;
  logs: Record<string, LogLine[]>; // by job id
  socket: WebSocket | null;
  refresh: () => Promise<void>;
  loadSchema: (backendId: string) => Promise<ParameterSchema>;
  select: (id: string | null) => void;
  upsert: (calc: Calculation) => void;
  connect: () => void;
  disconnect: () => void;
  clear: () => void;
}

const MAX_LOG_LINES = 5000;

export const useCalculationStore = create<CalculationState>((set, get) => ({
  calculations: [],
  schemas: {},
  selectedId: null,
  logs: {},
  socket: null,
  refresh: async () => {
    const calculations = await api.calculations.list();
    set({ calculations });
  },
  loadSchema: async (backendId) => {
    const cached = get().schemas[backendId];
    if (cached) return cached;
    const schema = await api.backends.schema(backendId);
    set((s) => ({ schemas: { ...s.schemas, [backendId]: schema } }));
    return schema;
  },
  select: (selectedId) => set({ selectedId }),
  upsert: (calc) =>
    set((s) => {
      const idx = s.calculations.findIndex((c) => c.id === calc.id);
      const calculations = [...s.calculations];
      if (idx >= 0) calculations[idx] = calc;
      else calculations.push(calc);
      return { calculations };
    }),
  connect: () => {
    if (get().socket) return;
    const ws = new WebSocket(api.calculations.eventsUrl());
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as {
        kind: 'log' | 'status';
        job_id: string;
        stream?: string;
        line?: string;
        status?: string;
      };
      if (msg.kind === 'log') {
        set((s) => {
          const prev = s.logs[msg.job_id] ?? [];
          const next = [...prev, { stream: msg.stream ?? '', line: msg.line ?? '' }];
          return { logs: { ...s.logs, [msg.job_id]: next.slice(-MAX_LOG_LINES) } };
        });
      } else {
        const calc = get().calculations.find((c) => c.job?.id === msg.job_id);
        if (calc) void api.calculations.get(calc.id).then((c) => get().upsert(c));
      }
    };
    ws.onclose = () => set({ socket: null });
    set({ socket: ws });
  },
  disconnect: () => {
    get().socket?.close();
    set({ socket: null });
  },
  clear: () => set({ calculations: [], selectedId: null, logs: {} }),
}));
