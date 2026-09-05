import { TOOL_INFO } from '../editor/tools';
import { useToolStore } from '../editor/toolStore';

/** Vertical tool strip; the ToolHost handles the single-key shortcuts. */
export function ToolBar(): JSX.Element {
  const active = useToolStore((s) => s.active);
  const setActive = useToolStore((s) => s.setActive);
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOL_INFO.map((t) => (
        <button
          key={t.id}
          className={t.id === active ? 'tool-button active' : 'tool-button'}
          title={`${t.label} (${t.shortcut.toUpperCase()}) — ${t.description}`}
          aria-label={t.label}
          aria-pressed={t.id === active}
          onClick={() => setActive(t.id)}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-key">{t.shortcut.toUpperCase()}</span>
        </button>
      ))}
    </nav>
  );
}
