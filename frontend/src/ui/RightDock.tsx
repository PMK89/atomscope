import { useState } from 'react';
import { AnalysisPanel } from './AnalysisPanel';
import { CalculationPanel } from './CalculationPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SurfacesPanel } from './SurfacesPanel';

type Tab = 'calculation' | 'analysis' | 'surfaces' | 'properties';
const TABS: { id: Tab; label: string }[] = [
  { id: 'calculation', label: 'Calculation' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'properties', label: 'Properties' },
];

/** Tab strip for the right dock. Panels stay mounted (hidden) so form state survives switching. */
export function RightDock({ onError }: { onError: (m: string) => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('calculation');
  return (
    <>
      <div className="tabs dock-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            className={tab === t.id ? 'tab active' : 'tab'}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== 'calculation'}>
        <CalculationPanel onError={onError} />
      </div>
      <div hidden={tab !== 'analysis'}>
        <AnalysisPanel onError={onError} />
      </div>
      <div hidden={tab !== 'surfaces'}>
        <SurfacesPanel onError={onError} />
      </div>
      <div hidden={tab !== 'properties'}>
        <PropertiesPanel />
      </div>
    </>
  );
}
