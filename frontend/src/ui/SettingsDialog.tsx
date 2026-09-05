/**
 * Avogadro's `Configure Avogadro…`: the settings that are not about one structure — rendering
 * quality, depth cueing, projection and background — and what the backend has installed.
 *
 * They are stored with the open project (the same view settings the Display tab writes), not
 * globally, so two projects can be configured differently.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type BackendInfo } from '../api/client';
import { useToolStore } from '../editor/toolStore';
import type { Quality } from '../renderer/layers/StructureLayer';
import { useViewStore } from '../state/viewStore';
import { dialogKeyHandler } from './dialogKeys';

const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Low (fastest)' },
  { id: 'auto', label: 'Automatic (by size)' },
  { id: 'high', label: 'High' },
];

export function SettingsDialog(): JSX.Element | null {
  const open = useToolStore((s) => s.settingsDialogOpen);
  const setOpen = useToolStore((s) => s.setSettingsDialogOpen);
  const view = useViewStore();
  const [backends, setBackends] = useState<BackendInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('select, button')?.focus();
    api.backends
      .list()
      .then(setBackends)
      .catch((e: Error) => setError(e.message));
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;

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
        aria-label="Preferences"
      >
        <h3>Preferences</h3>
        <h4>Rendering</h4>
        <div className="form-row">
          <label htmlFor="settings-quality">Quality</label>
          <select
            id="settings-quality"
            value={view.quality}
            onChange={(e) => view.setQuality(e.target.value as Quality)}
          >
            {QUALITIES.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="settings-fog">Depth cueing</label>
          <input
            id="settings-fog"
            type="checkbox"
            checked={view.fog}
            onChange={(e) => view.setFog(e.target.checked)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="settings-projection">Projection</label>
          <select
            id="settings-projection"
            value={view.projection}
            onChange={(e) => view.setProjection(e.target.value as typeof view.projection)}
          >
            <option value="perspective">Perspective</option>
            <option value="orthographic">Orthographic</option>
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="settings-background">Background</label>
          <select
            id="settings-background"
            value={view.background}
            onChange={(e) => view.setBackground(e.target.value as typeof view.background)}
          >
            <option value="white">White</option>
            <option value="gray">Grey</option>
            <option value="black">Black</option>
          </select>
        </div>

        <h4>Plugins</h4>
        {error && <p className="form-error">Could not read the backends: {error}</p>}
        {!backends && !error && <p className="muted">Reading the backend list…</p>}
        {backends && (
          <ul className="tree">
            {backends.map((b) => (
              <li key={b.id} className="muted">
                {b.name} — {b.executables.available ? 'available' : 'not available'}
                {b.executables.messages?.length ? ` (${b.executables.messages[0]})` : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Calculation backends are discovered on the server; they are enabled by installing them,
          not from here. These preferences are stored with the open project.
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
