import { useState } from 'react';
import { readLocal, writeLocal } from '../state/localSettings';
import { AnalysisPanel } from './AnalysisPanel';
import { CalculationPanel } from './CalculationPanel';
import { CrystalPanel } from './CrystalPanel';
import { DisplayPanel } from './DisplayPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SpectrumPanel } from './SpectrumPanel';
import { SurfacesPanel } from './SurfacesPanel';

type Tab =
  'calculation' | 'analysis' | 'spectra' | 'surfaces' | 'display' | 'crystal' | 'properties';
const TABS: { id: Tab; label: string }[] = [
  { id: 'calculation', label: 'Calculation' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'spectra', label: 'Spectra' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'display', label: 'Display' },
  { id: 'crystal', label: 'Crystal' },
  { id: 'properties', label: 'Properties' },
];

const DOCK_TAB_KEY = 'dock.tab';

const tabId = (id: Tab): string => `dock-tab-${id}`;
const panelId = (id: Tab): string => `dock-panel-${id}`;

/** Tab strip for the right dock. Panels stay mounted (hidden) so form state survives switching. */
export function RightDock({ onError }: { onError: (m: string) => void }): JSX.Element {
  // which tab was open is this browser's, like the tool settings (state/localSettings.ts)
  const [tab, setTabState] = useState<Tab>(() => {
    const stored = readLocal<string>(DOCK_TAB_KEY, 'calculation');
    return TABS.some((t) => t.id === stored) ? (stored as Tab) : 'calculation';
  });
  const setTab = (next: Tab): void => {
    setTabState(next);
    writeLocal(DOCK_TAB_KEY, next);
  };
  /** Wraps a panel so screen readers pair it with its tab. */
  const panel = (id: Tab, content: JSX.Element): JSX.Element => (
    <div role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={tab !== id}>
      {content}
    </div>
  );
  return (
    <>
      <div className="tabs dock-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={tabId(t.id)}
            className={tab === t.id ? 'tab active' : 'tab'}
            aria-selected={tab === t.id}
            aria-controls={panelId(t.id)}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {panel('calculation', <CalculationPanel onError={onError} />)}
      {panel('analysis', <AnalysisPanel onError={onError} />)}
      {panel('spectra', <SpectrumPanel onError={onError} />)}
      {panel('surfaces', <SurfacesPanel onError={onError} />)}
      {panel('display', <DisplayPanel />)}
      {panel('crystal', <CrystalPanel onError={onError} />)}
      {panel('properties', <PropertiesPanel onError={onError} />)}
    </>
  );
}
