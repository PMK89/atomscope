/**
 * One menu-bar menu: a title button plus a pop-up list. Implements the ARIA menu-button
 * keyboard contract - arrow keys move a roving focus, Home/End jump, Escape closes and returns
 * focus to the title, Tab closes without stealing focus.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  /** Present for checkable items; renders as a menuitemcheckbox. */
  checked?: boolean;
}

export function Menu({ title, items }: { title: string; items: MenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const titleId = useId();
  const selectable = items.flatMap((it, i) => (it.disabled ? [] : [i]));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // roving focus: the item at `focused` is the only tab stop and holds the DOM focus
  useEffect(() => {
    if (open) itemRefs.current[focused]?.focus();
  }, [open, focused]);

  const openAt = (index: number | undefined): void => {
    setFocused(index ?? 0);
    setOpen(true);
  };
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) titleRef.current?.focus();
  };
  const move = (delta: number): void => {
    if (selectable.length === 0) return;
    const pos = selectable.indexOf(focused);
    const next = pos < 0 ? 0 : (pos + delta + selectable.length) % selectable.length;
    setFocused(selectable[next] ?? 0);
  };

  const onTitleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt(selectable[0]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(selectable.at(-1));
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setFocused(selectable[0] ?? 0);
        break;
      case 'End':
        e.preventDefault();
        setFocused(selectable.at(-1) ?? 0);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button
        ref={titleRef}
        id={titleId}
        className={open ? 'menu-title open' : 'menu-title'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openAt(selectable[0]))}
        onKeyDown={onTitleKeyDown}
      >
        {title}
      </button>
      {open && (
        <ul
          className="menu-list"
          role="menu"
          id={listId}
          aria-labelledby={titleId}
          onKeyDown={onListKeyDown}
        >
          {items.map((it, i) => (
            <li key={it.label}>
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={it.checked}
                tabIndex={i === focused ? 0 : -1}
                disabled={it.disabled}
                onFocus={() => setFocused(i)}
                onClick={() => {
                  close(true);
                  it.action();
                }}
              >
                <span className="menu-check">{it.checked ? '•' : ''}</span>
                <span>{it.label}</span>
                {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
