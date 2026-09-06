/**
 * What AV-PLUG-001 asks of the frontend: something outside the application can contribute a
 * tool, and every place that shows tools shows it. The plugin here is a test fixture and is
 * never shipped; it registers into a registry of its own, which is why `PluginProvider` exists.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useToolStore } from '../editor/toolStore';
import type { Tool } from '../editor/Tool';
import { ToolBar } from '../ui/ToolBar';
import { ToolSettings } from '../ui/ToolSettings';
import { PluginProvider } from './context';
import { defaultRegistry } from './builtins';
import { PluginRegistry } from './registry';

class WireCutters implements Tool {
  readonly id = 'wire-cutters';
  readonly label = 'Wire cutters';
  readonly icon = '✂';
  readonly shortcut = 'w';
  readonly description = 'Cuts wires.';
}

function withPlugin(): PluginRegistry {
  const registry = defaultRegistry();
  registry.registerTool({
    tool: new WireCutters(),
    settings: () => <p>snips</p>,
  });
  return registry;
}

test('a contributed tool reaches the toolbar and can be made active', () => {
  render(
    <PluginProvider registry={withPlugin()}>
      <ToolBar />
    </PluginProvider>,
  );
  const button = screen.getByRole('button', { name: 'Wire cutters' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(button);
  expect(useToolStore.getState().active).toBe('wire-cutters');
});

test('a contributed tool brings its own settings panel', () => {
  useToolStore.getState().setActive('wire-cutters');
  render(
    <PluginProvider registry={withPlugin()}>
      <ToolSettings />
    </PluginProvider>,
  );
  expect(screen.getByText('Wire cutters')).toBeInTheDocument();
  expect(screen.getByText('snips')).toBeInTheDocument();
});

test('a tool with no settings panel shows its description', () => {
  useToolStore.getState().setActive('navigate');
  render(
    <PluginProvider registry={defaultRegistry()}>
      <ToolSettings />
    </PluginProvider>,
  );
  expect(screen.getByText(/Left-drag rotates/)).toBeInTheDocument();
});

test('the application registry does not carry a test plugin', () => {
  expect(defaultRegistry().tool('wire-cutters')).toBeUndefined();
  expect(defaultRegistry().tools()).toHaveLength(8);
});

test('registering the same id twice is refused', () => {
  const registry = withPlugin();
  expect(() => registry.registerTool({ tool: new WireCutters() })).toThrow('already registered');
});
