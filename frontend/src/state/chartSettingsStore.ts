/**
 * Per-chart display settings, kept outside the charts so they survive a tab switch or a reload.
 *
 * The set is `asecppaw`'s: its `plotDefault` (`globals.py`) carries `figArgs`, an `axArgs` that
 * receives `title`/`xlabel`/`ylabel` and the axis limits, a marker list, a colour list, a legend
 * location and a `pltStyle` of scatter/plot/errorbar/bar. What survives the translation to a
 * chart already drawn in a panel is the part a reader actually reaches for: the axis ranges, a
 * log y axis, whether points are drawn as well as lines, line weight and the legend. Titles and
 * labels are fixed per chart here because the chart is named by the panel it sits in.
 */
import { create } from 'zustand';

export interface ChartSettings {
  /** Axis ranges. `null` means "from the data", which is the default for both ends. */
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  logY: boolean;
  /** Draw a marker at each sample as well as the line -- `pltStyle: 'scatter'` and 'plot' at once. */
  markers: boolean;
  lineWidth: number;
  legend: boolean;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  xMin: null,
  xMax: null,
  yMin: null,
  yMax: null,
  logY: false,
  markers: false,
  lineWidth: 1.5,
  legend: true,
};

interface ChartSettingsState {
  byChart: Record<string, ChartSettings>;
  get: (id: string) => ChartSettings;
  set: (id: string, patch: Partial<ChartSettings>) => void;
  reset: (id: string) => void;
}

const KEY = 'atomscope.chartSettings';

/** Per-viewer convenience, so a lost value costs nothing and a throwing accessor must not. */
function load(): Record<string, ChartSettings> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, ChartSettings>) : {};
  } catch {
    return {};
  }
}

function save(byChart: Record<string, ChartSettings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(byChart));
  } catch {
    /* a private window, or site data blocked: the settings are simply not remembered */
  }
}

export const useChartSettingsStore = create<ChartSettingsState>((set, getState) => ({
  byChart: load(),
  get: (id) => getState().byChart[id] ?? DEFAULT_CHART_SETTINGS,
  set: (id, patch) =>
    set((s) => {
      const byChart = {
        ...s.byChart,
        [id]: { ...(s.byChart[id] ?? DEFAULT_CHART_SETTINGS), ...patch },
      };
      save(byChart);
      return { byChart };
    }),
  reset: (id) =>
    set((s) => {
      // rebuilt without `id` rather than deleted from a copy, which the lint rules disallow
      const byChart = Object.fromEntries(Object.entries(s.byChart).filter(([key]) => key !== id));
      save(byChart);
      return { byChart };
    }),
}));

/** Whether a log y axis is meaningful: it needs strictly positive values to plot. */
export function canLogY(series: readonly { y: readonly number[] }[]): boolean {
  return series.some((s) => s.y.some((v) => v > 0));
}
