import { useState } from 'react';
import { readLocal, writeLocal } from '../state/localSettings';
import { usePlugins } from '../plugins/context';

const DOCK_TAB_KEY = 'dock.tab';

const tabId = (id: string): string => `dock-tab-${id}`;
const panelId = (id: string): string => `dock-panel-${id}`;

/**
 * Tab strip for the right dock. Panels stay mounted (hidden) so form state survives switching,
 * and which panels there are is the plugin registry's to say (plugins/registry.ts).
 */
export function RightDock({ onError }: { onError: (m: string) => void }): JSX.Element {
  const panels = usePlugins().panels();
  const first = panels[0]?.id ?? '';
  // which tab was open is this browser's, like the tool settings (state/localSettings.ts); an id
  // from a build with another set of panels falls back to the first
  const [tab, setTabState] = useState<string>(() => {
    const stored = readLocal<string>(DOCK_TAB_KEY, first);
    return panels.some((p) => p.id === stored) ? stored : first;
  });
  const setTab = (next: string): void => {
    setTabState(next);
    writeLocal(DOCK_TAB_KEY, next);
  };
  return (
    <>
      <div className="tabs dock-tabs" role="tablist">
        {panels.map((p) => (
          <button
            key={p.id}
            role="tab"
            id={tabId(p.id)}
            className={tab === p.id ? 'tab active' : 'tab'}
            aria-selected={tab === p.id}
            aria-controls={panelId(p.id)}
            onClick={() => setTab(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panels.map(({ id, component: Panel }) => (
        <div
          key={id}
          role="tabpanel"
          id={panelId(id)}
          aria-labelledby={tabId(id)}
          hidden={tab !== id}
        >
          <Panel onError={onError} />
        </div>
      ))}
    </>
  );
}
