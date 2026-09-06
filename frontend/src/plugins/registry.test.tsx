/**
 * What AV-PLUG-001 asks of the frontend: something outside the application can contribute a
 * tool, and every place that shows tools shows it. The plugin here is a test fixture and is
 * never shipped; it registers into a registry of its own, which is why `PluginProvider` exists.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useToolStore } from '../editor/toolStore';
import { useStructureStore } from '../state/structureStore';
import { makeAtom, makeBond, normalizeStructure } from '../model/structure';
import type { Tool } from '../editor/Tool';
import { Object3D } from 'three';
import type { DisplayLayer } from '../renderer/layers/Layer';
import { installExtraLayers } from '../ui/viewportLayers';
import { MenuBar } from '../ui/MenuBar';
import { RightDock } from '../ui/RightDock';
import { ToolBar } from '../ui/ToolBar';
import { ToolSettings } from '../ui/ToolSettings';
import { PluginProvider } from './context';
import { defaultRegistry } from './builtins';
import { PluginRegistry } from './registry';

beforeEach(() => {
  useStructureStore.getState().load(normalizeStructure({ name: 'empty', charge: 0 }));
  useToolStore.getState().setActive('navigate');
});

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
  registry.registerPanel({ id: 'wires', label: 'Wires', component: () => <p>one wire</p> });
  registry.registerMenuItem({
    menuPath: 'Extensions',
    label: 'Cut wires',
    action: () => {
      const doc = useStructureStore.getState().doc;
      useStructureStore.getState().commit('Cut wires', { ...doc, bonds: [] });
    },
  });
  return registry;
}

class WireLayer implements DisplayLayer {
  readonly object = new Object3D();
  constructor(readonly id: string = 'wires') {}
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

test('a contributed menu item lands under the menu it names, and undoes like any edit', () => {
  const registry = withPlugin();
  // a bonded structure, so "cut the bonds" is an edit that can be seen rather than a no-op
  useStructureStore.getState().load(
    normalizeStructure({
      name: 'water',
      charge: 0,
      atoms: [makeAtom('O', [0, 0, 0]), makeAtom('H', [0.96, 0, 0]), makeAtom('H', [-0.3, 0.9, 0])],
      bonds: [makeBond(0, 1), makeBond(0, 2)],
    }),
  );
  expect(useStructureStore.getState().doc.bonds).toHaveLength(2);
  render(
    <PluginProvider registry={registry}>
      <MenuBar onError={() => {}} />
    </PluginProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Extensions' }));
  // below everything built in, which is what "additively" means
  const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
  expect(items[items.length - 1]).toContain('Cut wires');
  fireEvent.click(screen.getByRole('menuitem', { name: /Cut wires/ }));
  // performCommand with undo: a contributed action edits through the same history as a built-in
  expect(useStructureStore.getState().undoLabel()).toBe('Cut wires');
  expect(useStructureStore.getState().doc.bonds).toHaveLength(0);
});

test('a menu nothing built in provides is made for the item that asks for it', () => {
  const registry = withPlugin();
  registry.registerMenuItem({ menuPath: 'Wires', label: 'Coil', action: () => {} });
  render(
    <PluginProvider registry={registry}>
      <MenuBar onError={() => {}} />
    </PluginProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Wires' }));
  expect(screen.getByRole('menuitem', { name: 'Coil' })).toBeInTheDocument();
});

test('a menu path with more than one level is refused', () => {
  expect(() =>
    defaultRegistry().registerMenuItem({ menuPath: 'a/b', label: 'x', action: () => {} }),
  ).toThrow('more than one level');
});

test('a layer whose factory builds another layer is refused rather than lost', () => {
  // a registry of its own: building the application's layers wants a canvas jsdom has not got
  const registry = new PluginRegistry();
  registry.registerLayer({ id: 'wires', create: () => new WireLayer('cables') });
  expect(() => installExtraLayers(new FakeRenderer() as never, registry)).toThrow('calls itself');
});

test('the application registry does not carry a test plugin', () => {
  const registry = defaultRegistry();
  expect(registry.tool('wire-cutters')).toBeUndefined();
  expect(registry.tools()).toHaveLength(8);
  expect(registry.panels().map((p) => p.id)).not.toContain('wires');
  expect(registry.layers().map((l) => l.id)).not.toContain('wires');
  expect(registry.menuItems('Extensions')).toHaveLength(0);
});

test('registering the same id twice is refused, and so is taking a shortcut twice', () => {
  const registry = withPlugin();
  expect(() => registry.registerTool({ tool: new WireCutters() })).toThrow('already registered');
  expect(() =>
    registry.registerPanel({ id: 'wires', label: 'Wires again', component: () => <p /> }),
  ).toThrow('already registered');
  const pliers: Tool = { ...new WireCutters(), id: 'pliers', label: 'Pliers' };
  expect(() => registry.registerTool({ tool: pliers })).toThrow('shortcut');
});
