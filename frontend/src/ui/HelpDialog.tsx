/**
 * Help > … : the shortcuts, where the written documentation lives, and what this program is.
 *
 * The guides are Markdown files in the repository rather than pages in the app; this dialog names
 * them so that a user who opened Atomscope without reading the README can find them.
 */
import { useEffect, useRef } from 'react';
import { dialogKeyHandler } from './dialogKeys';

export type HelpTopic = 'user-guide' | 'tutorials' | 'shortcuts' | 'about';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+O', 'Open a file'],
  ['Ctrl+S / Ctrl+Shift+S', 'Save / Save as'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
  ['Ctrl+A / Ctrl+Shift+A', 'Select all / none'],
  ['Ctrl+X / Ctrl+C / Ctrl+V', 'Cut / Copy / Paste'],
  ['Ctrl+Backspace', 'Clear the selection'],
  ['1 / 2 / 3', 'Bond order while drawing'],
  ['Left-drag / right-drag / wheel', 'Rotate / pan / zoom'],
  ['Double-click', 'Centre on an atom'],
];

const GUIDES: Record<'user-guide' | 'tutorials', { title: string; items: string[] }> = {
  'user-guide': {
    title: 'User guide',
    items: [
      'docs/user-guide.md — the whole application: projects, building, calculations, analysis.',
      'docs/developer-guide.md — the architecture, the plugin contract and how to add a backend.',
      'docs/avogadro1-feature-parity.md — what is implemented, what is not, and where.',
    ],
  },
  tutorials: {
    title: 'Tutorials',
    items: [
      'docs/tutorials/01-water-cppaw.md — a water molecule through CP-PAW, start to finish.',
      'docs/tutorials/02-silicon-crystal.md — a silicon crystal: cell, symmetry, bands and DOS.',
      'docs/tutorials/03-force-field-and-conformers.md — force fields and a conformer search.',
    ],
  },
};

export function HelpDialog({
  topic,
  onClose,
}: {
  topic: HelpTopic | null;
  onClose: () => void;
}): JSX.Element | null {
  const dialog = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!topic) return;
    const previous = document.activeElement as HTMLElement | null;
    button.current?.focus();
    return () => previous?.focus();
  }, [topic]);
  if (!topic) return null;

  const onKeyDown = dialogKeyHandler(dialog, onClose);

  const guide = topic === 'user-guide' || topic === 'tutorials' ? GUIDES[topic] : null;
  const title = guide
    ? guide.title
    : topic === 'shortcuts'
      ? 'Keyboard shortcuts'
      : 'About Atomscope';

  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div className="dialog panel" ref={dialog} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {guide && (
          <ul className="help-list">
            {guide.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        {topic === 'shortcuts' && (
          <table className="help-table">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys}>
                  <td>
                    <kbd>{keys}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {topic === 'about' && (
          <div className="help-list">
            <p>
              Atomscope is a molecular modeling, simulation and analysis environment: an editor and
              viewer, a calculation front end for ASE and CP-PAW, and the analysis that goes with
              them.
            </p>
            <p className="muted">
              Licensed under the GPL-3.0. Third-party notices are in THIRD_PARTY_LICENSES.md, and
              where each piece of borrowed material came from is recorded in docs/provenance.md.
            </p>
          </div>
        )}
        <div className="button-row">
          <button ref={button} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
