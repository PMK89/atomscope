import { useState } from 'react';
import { AnalysisPanel } from './AnalysisPanel';
import { CalculationPanel } from './CalculationPanel';
import { CrystalPanel } from './CrystalPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SpectrumPanel } from './SpectrumPanel';
import { SurfacesPanel } from './SurfacesPanel';

type Tab = 'calculation' | 'analysis' | 'spectra' | 'surfaces' | 'crystal' | 'properties';
const TABS: { id: Tab; label: string }[] = [
  { id: 'calculation', label: 'Calculation' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'spectra', label: 'Spectra' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'crystal', label: 'Crystal' },
  { id: 'properties', label: 'Properties' },
];

const tabId = (id: Tab): string => `dock-tab-${id}`;
const panelId = (id: Tab): string => `dock-panel-${id}`;

/** Tab strip for the right dock. Panels stay mounted (hidden) so form state survives switching. */
export function RightDock({ onError }: { onError: (m: string) => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('calculation');
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
      {panel('crystal', <CrystalPanel onError={onError} />)}
      {panel('properties', <PropertiesPanel />)}
    </>
  );
}
