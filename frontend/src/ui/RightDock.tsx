import { useState } from 'react';
import { CalculationPanel } from './CalculationPanel';
import { PropertiesPanel } from './PropertiesPanel';

/** Tab strip for the right dock. */
export function RightDock({ onError }: { onError: (m: string) => void }): JSX.Element {
  const [tab, setTab] = useState<'calculation' | 'properties'>('calculation');
  return (
    <>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          className={tab === 'calculation' ? 'tab active' : 'tab'}
          aria-selected={tab === 'calculation'}
          onClick={() => setTab('calculation')}
        >
          Calculation
        </button>
        <button
          role="tab"
          className={tab === 'properties' ? 'tab active' : 'tab'}
          aria-selected={tab === 'properties'}
          onClick={() => setTab('properties')}
        >
          Properties
        </button>
      </div>
      {tab === 'calculation' ? <CalculationPanel onError={onError} /> : <PropertiesPanel />}
    </>
  );
}
