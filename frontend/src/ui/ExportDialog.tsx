/**
 * File > Export… (Avogadro's Save As with its format filters): write the structure to a file on
 * this machine in any format the backend can write, or download it through the browser.
 *
 * The format and the file name follow one another, as they do in a file dialog with filters:
 * typing `.cif` picks CIF, picking CIF renames the file. Writing over an existing file is refused
 * by the backend until this dialog asks again, so a Save As cannot quietly replace someone's work.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type FormatDescription } from '../api/client';
import { useStructureStore } from '../state/structureStore';
import { dialogKeyHandler } from './dialogKeys';
import {
  defaultFormat,
  extensionOf,
  formatForPath,
  pathForFormat,
  writableFormats,
} from './exportFormats';

export function ExportDialog({
  open,
  onClose,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}): JSX.Element | null {
  const doc = useStructureStore((s) => s.doc);
  const [formats, setFormats] = useState<FormatDescription[]>([]);
  const [format, setFormat] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  /** the path the backend refused because something is already there */
  const [conflict, setConflict] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  /**
   * The path as last typed, readable from the format list's own callback. That list is fetched
   * when the dialog opens, and until it arrives the format box has nothing in it -- so a path
   * typed in the meantime has no writer yet, and the defaults the callback then applies would
   * throw the path away. It picks the writer from what was typed instead.
   */
  const typed = useRef('');

  // `onError` is the App's setState, which never changes identity: this effect sets the format and
  // the path, so it must not re-run while the dialog is open or it would overwrite what is typed.
  useEffect(() => {
    if (!open) return;
    typed.current = '';
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    api.io
      .formats()
      .then((list) => {
        setFormats(list);
        // where the structure came from decides both the format and the folder, as a Save As does
        const source = doc.provenance?.source ?? '';
        const from = extensionOf(source) ? formatForPath(list, source) : null;
        const chosen = defaultFormat(list, from);
        if (typed.current) {
          // typed before the writers were known: the path chooses one, as it does afterwards
          setFormat(formatForPath(list, typed.current, chosen) ?? chosen);
          return;
        }
        setFormat(chosen);
        setPath(extensionOf(source) ? pathForFormat(list, source, chosen) : '');
      })
      .catch((e: Error) => onError(e.message));
    return () => previous?.focus();
  }, [open, onError, doc.provenance]);
  if (!open) return null;

  const onPath = (next: string): void => {
    typed.current = next;
    setPath(next);
    setConflict(null);
    // an extension nothing claims leaves the format alone: it is the format that decides the writer
    const named = formatForPath(formats, next, format);
    if (named) setFormat(named);
  };

  const onFormat = (next: string): void => {
    setFormat(next);
    setConflict(null);
    setPath((p) => pathForFormat(formats, p, next));
  };

  const save = async (overwrite: boolean): Promise<void> => {
    const target = path.trim();
    if (!target || !format) return;
    setBusy(true);
    try {
      await api.io.export({ structure: doc, format, path: target, overwrite });
      setConflict(null);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(target);
      else onError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const download = async (): Promise<void> => {
    if (!format) return;
    setBusy(true);
    try {
      const res = await api.io.export({ structure: doc, format, overwrite: false });
      const blob = new Blob([res.text ?? ''], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const extension = formats.find((f) => f.name === format)?.extensions[0] ?? format;
      a.download = `${doc.name || 'structure'}.${extension}`;
      a.click();
      URL.revokeObjectURL(a.href);
      onClose();
    } catch (e) {
      onError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={dialogKeyHandler(dialog, onClose)}
    >
      <div
        className="dialog panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Export"
      >
        <h3>Export</h3>
        <div className="form-row">
          <label htmlFor="export-format">Format</label>
          <select id="export-format" value={format} onChange={(e) => onFormat(e.target.value)}>
            {writableFormats(formats).map((f) => (
              <option key={f.name} value={f.name}>
                {f.description} ({f.extensions.join(', ')})
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="export-path">Path on this machine</label>
          <input
            id="export-path"
            ref={first}
            value={path}
            placeholder="/home/user/structures/water.cif"
            onChange={(e) => onPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save(false)}
          />
        </div>
        {conflict && (
          <p className="muted" role="alert">
            {conflict} exists already. Write over it?
          </p>
        )}
        <div className="button-row">
          {conflict ? (
            <button className="primary" onClick={() => void save(true)} disabled={busy}>
              Overwrite
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => void save(false)}
              disabled={!path.trim() || !format || busy}
            >
              Save
            </button>
          )}
          <button onClick={() => void download()} disabled={!format || busy}>
            Download
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">
          The backend runs on this machine, so the file is written directly to the path given; a
          relative path lands beside the server. Download saves through the browser instead.
        </p>
      </div>
    </div>
  );
}
