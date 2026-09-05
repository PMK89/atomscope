/**
 * File > Open… (Avogadro's Open / Import Molecule File): a file from the browser or a path on this
 * machine, with the format detection overridable.
 *
 * The override is what makes a Gaussian output called `run.txt` openable: detection goes by
 * extension first, and a file whose extension says nothing needs to be told what it is.
 */
import { useEffect, useRef, useState } from 'react';
import { dialogKeyHandler } from './dialogKeys';
import { api, type FormatDescription } from '../api/client';
import { normalizeStructure } from '../model/structure';
import { useStructureStore } from '../state/structureStore';

/** `accept` for the file picker: every extension a reader claims. */
export function acceptFilter(formats: FormatDescription[]): string {
  const extensions = formats
    .filter((f) => f.can_read)
    .flatMap((f) => f.extensions)
    .map((e) => `.${e}`);
  return [...new Set(extensions)].sort().join(',');
}

export function ImportDialog({
  open,
  onClose,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}): JSX.Element | null {
  const load = useStructureStore((s) => s.load);
  const [formats, setFormats] = useState<FormatDescription[]>([]);
  const [format, setFormat] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    api.io
      .formats()
      .then(setFormats)
      .catch((e: Error) => onError(e.message));
    return () => previous?.focus();
  }, [open, onError]);
  if (!open) return null;

  const finish = (structure: Parameters<typeof normalizeStructure>[0]): void => {
    load(normalizeStructure(structure));
    onClose();
  };

  const openPath = async (): Promise<void> => {
    if (!path.trim()) return;
    setBusy(true);
    try {
      finish(await api.io.importPath({ path: path.trim(), ...(format ? { format } : {}) }));
    } catch (e) {
      onError(`Open failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      finish(await api.io.importUpload(file, format || undefined));
    } catch (e) {
      onError(`Open failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = dialogKeyHandler(dialog, onClose);

  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog panel" ref={dialog} role="dialog" aria-modal="true" aria-label="Open">
        <h3>Open</h3>
        <div className="form-row">
          <label htmlFor="import-format">Format</label>
          <select id="import-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Detect from the file</option>
            {formats
              .filter((f) => f.can_read)
              .map((f) => (
                <option key={f.name} value={f.name}>
                  {f.description} ({f.extensions.join(', ')})
                </option>
              ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="import-path">Path on this machine</label>
          <input
            id="import-path"
            ref={first}
            value={path}
            placeholder="/home/user/structures/water.xyz"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void openPath()}
          />
        </div>
        <div className="button-row">
          <button onClick={() => void openPath()} disabled={!path.trim() || busy}>
            Open path
          </button>
          <button onClick={() => fileInput.current?.click()} disabled={busy}>
            Choose a file…
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">
          The backend runs on this machine, so a path is read directly; choosing a file uploads it.
        </p>
        <input
          ref={fileInput}
          type="file"
          hidden
          data-testid="import-file-input"
          accept={acceptFilter(formats)}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
