/**
 * The keyboard contract every modal dialog here shares: Escape closes it, Tab cycles inside it.
 * A modal that lets Tab reach the application behind it is a modal in appearance only.
 */
import type { KeyboardEvent, RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]';

/** Keydown handler for the dialog backdrop: Escape calls `onClose`, Tab stays inside `dialog`. */
export function dialogKeyHandler(
  dialog: RefObject<HTMLElement | null>,
  onClose: () => void,
): (e: KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    if (e.key === 'Escape') {
      // the application's own shortcuts must not also see it
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => !el.hasAttribute('hidden') && el.tabIndex >= 0,
    );
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}
