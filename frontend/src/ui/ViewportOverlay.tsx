import { useEffect, useState } from 'react';
import type { ToolHost } from '../editor/ToolHost';
import { useToolStore } from '../editor/toolStore';
import type { Renderer } from '../renderer/Renderer';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';

/** SVG layer over the canvas drawing whatever the active tool's `overlay()` returns. */
export function ViewportOverlay({
  renderer,
  host,
}: {
  renderer: Renderer;
  host: ToolHost;
}): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((t) => t + 1);
    renderer.onInvalidate = bump;
    const unsubs = [
      useToolStore.subscribe(bump),
      useStructureStore.subscribe(bump),
      useSelectionStore.subscribe(bump),
    ];
    return () => {
      renderer.onInvalidate = null;
      for (const u of unsubs) u();
    };
  }, [renderer]);
  const shapes = host.activeTool.overlay?.(host.ctx) ?? [];
  return (
    <svg className="viewport-overlay" data-testid="viewport-overlay">
      {shapes.map((s, i) => {
        switch (s.kind) {
          case 'line':
            return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="ov-line" />;
          case 'rect':
            return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} className="ov-rect" />;
          case 'marker':
            return (
              <g key={i}>
                <circle cx={s.x} cy={s.y} r={7} className="ov-marker" />
                <text x={s.x + 9} y={s.y - 6} className="ov-text">
                  {s.text}
                </text>
              </g>
            );
          case 'label':
            return (
              <text key={i} x={s.x} y={s.y} className="ov-text ov-label">
                {s.text}
              </text>
            );
        }
      })}
    </svg>
  );
}
