import type { DosSpectrum } from '../api/client';
import type { ChartSeries } from '../ui/charts/LineChart';

/**
 * A stacked, filled density of states, the shape the course's DOS figures have (Figs 3.1, 4.2,
 * 4.6, 6.1, 6.8, 7.1, 7.3).
 *
 * The total is drawn as an outline and the projections partition the area under it, each filled
 * between the running cumulative total and its own top edge. Which series may be stacked is the
 * backend's call, not a guess from the series name: `group` is set only on weights that
 * partition something (see `DosSeries.group`), so the total and hand-built orbital weights --
 * which overlap whatever else was asked for -- are excluded by construction.
 *
 * Per group, the angular-momentum channels are used when they were requested and the whole atom
 * or element otherwise. Asking for l channels therefore gives the l-resolved stack of Fig. 3.1;
 * leaving them off gives the element stack of Fig. 4.2. The stack reaches the total only as far
 * as the requested channels account for it, which is why the total stays an outline: the
 * shortfall is visible rather than hidden.
 *
 * Spin channels accumulate separately. CP-PAW writes spin-down negative, so the two stacks grow
 * away from zero in opposite directions with no extra convention here.
 */
export function stackedDosSeries(
  dos: DosSpectrum,
  splitX: number | undefined,
  colorFor: (series: DosSpectrum['series'][number], index: number) => string,
): { stacked: ChartSeries[]; outlines: ChartSeries[] } {
  const plottable = dos.series.filter((s) => s.kind !== 'coop');
  const stackable = plottable.filter((s) => s.group != null);

  // per group, the finest partition that was actually asked for
  const withChannels = new Set(stackable.filter((s) => s.channel != null).map((s) => s.group!));
  const chosen = stackable.filter((s) =>
    withChannels.has(s.group!) ? s.channel != null : s.channel == null,
  );

  const running = new Map<string, number[]>();
  const stacked: ChartSeries[] = chosen.map((s, i) => {
    const base = running.get(s.spin) ?? new Array<number>(dos.energies.length).fill(0);
    const top = base.map((v, k) => v + (s.dos[k] ?? 0));
    running.set(s.spin, top);
    return {
      id: `${s.id}-${s.spin}`,
      label: s.spin === 'none' ? s.label : `${s.label} (${s.spin})`,
      x: dos.energies,
      y: top,
      baseline: base,
      color: colorFor(s, i),
      ...(splitX === undefined ? {} : { fillSplitX: splitX }),
    };
  });

  // everything the stack cannot account for, drawn as a plain line on top of it
  const outlines: ChartSeries[] = plottable
    .filter((s) => !chosen.includes(s))
    .map((s, i) => ({
      id: `${s.id}-${s.spin}`,
      label: s.spin === 'none' ? s.label : `${s.label} (${s.spin})`,
      x: dos.energies,
      y: s.dos,
      color: colorFor(s, i),
      dashed: s.spin === 'down',
    }));

  return { stacked, outlines };
}
