/**
 * Select ▸ Named selections…: the sets the user has saved, with what is left of each one.
 *
 * Avogadro lists them in the project tree under "User Selections" and lets them be renamed and
 * removed there. This is the same list as a dialog, plus the count of atoms each set still has --
 * a set names its atoms by uid, so one narrows as its atoms are deleted.
 */
import { useRef } from 'react';
import { removeNamed, renameNamed, resolveNamed } from '../editor/namedSelections';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { dialogKeyHandler } from './dialogKeys';

export function NamedSelectionsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const doc = useStructureStore((s) => s.doc);
  const named = useSelectionStore((s) => s.named);
  const setNamed = useSelectionStore((s) => s.setNamed);
  const select = useSelectionStore((s) => s.set);
  const dialog = useRef<HTMLDivElement>(null);
  if (!open) return null;

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
        aria-label="Named selections"
      >
        <h3>Named selections</h3>
        {named.length === 0 ? (
          <p className="muted">
            No named selections. Select some atoms and use Select ▸ Add named selection….
          </p>
        ) : (
          <div className="orbital-table-wrap">
            <table className="orbital-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Atoms</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {named.map((entry) => {
                  const present = resolveNamed(doc, entry);
                  return (
                    <tr key={entry.name}>
                      <td>{entry.name}</td>
                      <td>
                        {present.length === entry.uids.length
                          ? present.length
                          : `${present.length} of ${entry.uids.length}`}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={present.length === 0}
                          onClick={() => {
                            select(present);
                            onClose();
                          }}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const to = window.prompt('New name', entry.name);
                            if (to) setNamed(renameNamed(named, entry.name, to));
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => setNamed(removeNamed(named, entry.name))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          A set names its atoms, not their positions in the list, so it survives an edit; atoms it
          named and the document no longer has are left out. Named selections are not saved with the
          project.
        </p>
        <div className="button-row">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
