/**
 * What AV-PLUG-001 asks of the frontend: something outside the application can contribute a
 * tool, and every place that shows tools shows it. The plugin here is a test fixture and is
 * never shipped; it registers into a registry of its own, which is why `PluginProvider` exists.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useToolStore } from '../editor/toolStore';
import type { Tool } from '../editor/Tool';
import { Object3D } from 'three';
import type { DisplayLayer } from '../renderer/layers/Layer';
import { installExtraLayers } from '../ui/viewportLayers';
import { RightDock } from '../ui/RightDock';
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
  registry.registerPanel({ id: 'wires', label: 'Wires', render: () => <p>one wire</p> });
  return registry;
}

class WireLayer implements DisplayLayer {
  readonly id = 'wires';
  readonly object = new Object3D();
  visible = true;
  update(): void {}
  dispose(): void {}
}

/** Only what `installExtraLayers` touches. */
class FakeRenderer {
  readonly added: DisplayLayer[] = [];
  addLayer(layer: DisplayLayer): void {
    this.added.push(layer);
  }
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

test('a contributed dock panel gets a tab of its own, and its panel is paired with it', () => {
  const registry = withPlugin();
  render(
    <PluginProvider registry={registry}>
      <RightDock onError={() => {}} />
    </PluginProvider>,
  );
  const tab = screen.getByRole('tab', { name: 'Wires' });
  const panel = document.getElementById(tab.getAttribute('aria-controls')!);
  expect(panel).toHaveAttribute('role', 'tabpanel');
  expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  expect(tab).toHaveAttribute('aria-selected', 'false');
  fireEvent.click(tab);
  expect(tab).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('one wire')).toBeVisible();
});

test('a contributed layer is added to a renderer, one instance per renderer', () => {
  const registry = withPlugin();
  const built: WireLayer[] = [];
  registry.registerLayer({
    id: 'wires',
    create: () => {
      const layer = new WireLayer();
      built.push(layer);
      return layer;
    },
  });
  const first = new FakeRenderer();
  const second = new FakeRenderer();
  installExtraLayers(first as never, registry);
  installExtraLayers(second as never, registry);
  expect(first.added.map((l) => l.id)).toContain('wires');
  // the factory is what keeps two renderers from sharing one layer's Three objects
  expect(built).toHaveLength(2);
  expect(built[0]).not.toBe(built[1]);
});

test('the application registry does not carry a test plugin', () => {
  const registry = defaultRegistry();
  expect(registry.tool('wire-cutters')).toBeUndefined();
  expect(registry.tools()).toHaveLength(8);
  expect(registry.panels().map((p) => p.id)).not.toContain('wires');
  expect(registry.layers().map((l) => l.id)).not.toContain('wires');
});

test('registering the same id twice is refused, and so is taking a shortcut twice', () => {
  const registry = withPlugin();
  expect(() => registry.registerTool({ tool: new WireCutters() })).toThrow('already registered');
  expect(() =>
    registry.registerPanel({ id: 'wires', label: 'Wires again', render: () => <p /> }),
  ).toThrow('already registered');
  const pliers: Tool = { ...new WireCutters(), id: 'pliers', label: 'Pliers' };
  expect(() => registry.registerTool({ tool: pliers })).toThrow('shortcut');
});
