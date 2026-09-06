/**
 * Avogadro's Plugin Manager (AV-PLUG-001, `avogadro/src/pluginsettings.cpp`): a kind to look at,
 * the plugins of that kind with a switch each, and the details of the selected one.
 *
 * Two differences from its own, both consequences of what a plugin is here. Its details pane
 * showed Name, Identifier, File and Description; a plugin here is a module rather than a file, so
 * the kind stands where the file did. And its unit was one plugin file -- an extension file could
 * contribute several actions -- where ours is one contribution, so the Extensions list is
 * finer-grained; the built-in menu items, which are literal arrays in `MenuBar` rather than
 * contributions, do not appear at all.
 */
import { useEffect, useRef, useState } from 'react';
import { useToolStore } from '../editor/toolStore';
import { usePlugins } from '../plugins/context';
import { FALLBACK_COLOR_SCHEME, type PluginItem, type PluginKind } from '../plugins/registry';
import { usePluginStore } from '../state/pluginStore';
import { useViewStore } from '../state/viewStore';
import { dialogKeyHandler } from './dialogKeys';

const KINDS: { id: PluginKind; label: string }[] = [
  { id: 'layer', label: 'Display types' },
  { id: 'tool', label: 'Tools' },
  { id: 'menu', label: 'Extensions' },
  { id: 'color', label: 'Colours' },
  { id: 'panel', label: 'Panels' },
];

export function PluginManagerDialog(): JSX.Element | null {
  const open = useToolStore((s) => s.pluginManagerOpen);
  const setOpen = useToolStore((s) => s.setPluginManagerOpen);
  const registry = usePlugins();
  const disabled = usePluginStore((s) => s.disabled);
  const setEnabled = usePluginStore((s) => s.setEnabled);
  const colorScheme = useViewStore((s) => s.colorScheme);
  const setColorScheme = useViewStore((s) => s.setColorScheme);
  const [kind, setKind] = useState<PluginKind>('layer');
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('select, button')?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;

  const items = registry.items().filter((i) => i.kind === kind);
  const details = items.find((i) => i.id === selected) ?? null;

  const toggle = (item: PluginItem, on: boolean): void => {
    setEnabled(item.kind, item.id, on);
    // the scheme the view is painting with has just gone: it falls back the way an unknown tool
    // id does in ToolHost, so the atoms are not silently left their element colours
    if (!on && item.kind === 'color' && colorScheme === item.id) {
      setColorScheme(FALLBACK_COLOR_SCHEME);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={dialogKeyHandler(dialog, () => setOpen(false))}
    >
      <div
        className="dialog panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Plugin manager"
      >
        <h3>Plugin manager</h3>
        <div className="form-row">
          <label htmlFor="plugin-kind">Kind</label>
          <select
            id="plugin-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PluginKind);
              setSelected(null);
            }}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <ul className="plugin-list">
          {items.length === 0 && <li className="muted">Nothing of this kind is registered.</li>}
          {items.map((item) => (
            <li key={item.id}>
              <label title={item.removable ? undefined : 'everything else falls back to this one'}>
                <input
                  type="checkbox"
                  checked={!disabled.has(`${item.kind}:${item.id}`)}
                  disabled={!item.removable}
                  onChange={(e) => toggle(item, e.target.checked)}
                />
                {item.name}
              </label>
              <button type="button" onClick={() => setSelected(item.id)}>
                Details
              </button>
            </li>
          ))}
        </ul>
        {details && (
          <div className="plugin-details" data-testid="plugin-details">
            <p>
              <strong>Name:</strong> {details.name}
            </p>
            <p>
              <strong>Identifier:</strong> {details.id}
            </p>
            <p>
              <strong>Kind:</strong> {KINDS.find((k) => k.id === details.kind)?.label}
            </p>
            <p>{details.description}</p>
          </div>
        )}
        <div className="button-row">
          <button className="primary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
