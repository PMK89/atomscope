import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useToolStore } from '../editor/toolStore';
import { useStructureStore } from '../state/structureStore';
import { makeAtom, normalizeStructure } from '../model/structure';

const { forceFields } = vi.hoisted(() => ({ forceFields: vi.fn() }));
vi.mock('../api/client', async (original) => {
  const actual = await original<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, chem: { ...actual.api.chem, forceFields } } };
});

import { ToolSettings } from './ToolSettings';
import { PluginProvider } from '../plugins/context';
import { plugins } from '../plugins/builtins';

beforeEach(() => {
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'x', charge: 0, atoms: [makeAtom('C', [0, 0, 0])] }));
  forceFields.mockResolvedValue({ force_fields: ['MMFF94', 'UFF'], charge_models: [] });
});

test('a remembered selection mode stays in its own box, even without residues to select', () => {
  useToolStore.setState({ active: 'select', select: { mode: 'residues', rect: null } });
  render(
    <PluginProvider registry={plugins()}>
      <ToolSettings />
    </PluginProvider>,
  );
  const box = screen.getByLabelText('Selection mode');
  expect(box).toHaveValue('residues');
  expect(screen.getByRole('option', { name: 'Residues' })).toBeInTheDocument();
});

test('a force field this Open Babel does not have falls back to one it does', async () => {
  useToolStore.setState({
    active: 'auto-optimize',
    autoOptimize: {
      ...useToolStore.getState().autoOptimize,
      forceField: 'Ghemical', // remembered from a build that had it
    },
  });
  render(
    <PluginProvider registry={plugins()}>
      <ToolSettings />
    </PluginProvider>,
  );
  await waitFor(() => expect(useToolStore.getState().autoOptimize.forceField).toBe('MMFF94'));
  expect(screen.getByLabelText('Force field')).toHaveValue('MMFF94');
});

test('a force field the backend does offer is left alone', async () => {
  useToolStore.setState({
    active: 'auto-optimize',
    autoOptimize: { ...useToolStore.getState().autoOptimize, forceField: 'UFF' },
  });
  render(
    <PluginProvider registry={plugins()}>
      <ToolSettings />
    </PluginProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText('Force field')).toHaveValue('UFF'));
  expect(useToolStore.getState().autoOptimize.forceField).toBe('UFF');
});
