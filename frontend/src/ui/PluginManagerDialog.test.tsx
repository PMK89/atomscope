/**
 * AV-PLUG-001's acceptance criterion: "Plugins enable/disable; details shown". Turning one off
 * has to mean something, and each kind means something different, so each is checked where it
 * shows: the toolbar, the dock's tabs, the Colour by list, the menus and a running renderer.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useToolStore } from '../editor/toolStore';
import { defaultRegistry } from '../plugins/builtins';
import { PluginProvider } from '../plugins/context';
import { enabledLayers } from '../plugins/enabled';
import type { PluginRegistry } from '../plugins/registry';
import { usePluginStore } from '../state/pluginStore';
import { useViewStore } from '../state/viewStore';
import { MenuBar } from './MenuBar';
import { PluginManagerDialog } from './PluginManagerDialog';
import { RightDock } from './RightDock';
import { ToolBar } from './ToolBar';

let registry: PluginRegistry;

beforeEach(() => {
  registry = defaultRegistry();
  usePluginStore.setState({ disabled: new Set() });
  useToolStore.getState().setActive('navigate');
  useToolStore.getState().setPluginManagerOpen(true);
  useViewStore.getState().setColorScheme('element');
});

const open = (kind: string): void => {
  render(
    <PluginProvider registry={registry}>
      <PluginManagerDialog />
    </PluginProvider>,
  );
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: kind } });
};

const switchOff = (name: string): void => {
  const row = screen.getByLabelText(name);
  expect(row).toBeChecked();
  fireEvent.click(row);
};

test('the details of a plugin are its name, its identifier, its kind and what it does', () => {
  open('tool');
  const row = screen.getByText('Measure').closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Details' }));
  const details = screen.getByTestId('plugin-details');
  expect(details).toHaveTextContent('Name: Measure');
  expect(details).toHaveTextContent('Identifier: measure');
  expect(details).toHaveTextContent('Kind: Tools');
  expect(details.textContent).toMatch(/distance|angle|torsion/i);
});

test('a tool that is switched off leaves the toolbar', () => {
  open('tool');
  switchOff('Measure');
  render(
    <PluginProvider registry={registry}>
      <ToolBar />
    </PluginProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Measure' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Draw' })).toBeInTheDocument();
});

test('a dock panel that is switched off loses its tab, and an open one falls back', () => {
  open('panel');
  switchOff('Spectra');
  render(
    <PluginProvider registry={registry}>
      <RightDock onError={() => {}} />
    </PluginProvider>,
  );
  expect(screen.queryByRole('tab', { name: 'Spectra' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'Calculation' })).toHaveAttribute('aria-selected', 'true');
});

test('a colour scheme that is switched off takes the view back to element colours', () => {
  useViewStore.getState().setColorScheme('index');
  open('color');
  switchOff('Atom index');
  expect(useViewStore.getState().colorScheme).toBe('element');
});

test('the two everything else falls back to cannot be switched off', () => {
  open('tool');
  expect(screen.getByLabelText('Navigate')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'color' } });
  expect(screen.getByLabelText('Element')).toBeDisabled();
});

test('a layer that is switched off is one the renderer is not given', () => {
  open('layer');
  switchOff('Ribbons');
  const ids = enabledLayers(registry, usePluginStore.getState().disabled).map((c) => c.id);
  expect(ids).not.toContain('ribbon');
  expect(ids).toContain('hbonds');
});

test('an extension that is switched off leaves its menu', () => {
  registry.registerMenuItem({
    id: 'cut-wires',
    menuPath: 'Extensions',
    label: 'Cut wires',
    description: 'Removes every bond.',
    action: () => {},
  });
  open('menu');
  switchOff('Extensions: Cut wires');
  expect([...usePluginStore.getState().disabled]).toEqual(['menu:cut-wires']);
  render(
    <PluginProvider registry={registry}>
      <MenuBar onError={() => {}} />
    </PluginProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Extensions' }));
  expect(screen.queryByRole('menuitem', { name: /Cut wires/ })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Perceive bonds' })).toBeInTheDocument();
});
