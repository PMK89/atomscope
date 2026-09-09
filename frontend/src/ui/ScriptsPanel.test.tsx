import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { api, type Script, type ScriptRun } from '../api/client';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';
import { ScriptsPanel } from './ScriptsPanel';

const script = (id: string, source: string): Script => ({ id, source });

const run = (over: Partial<ScriptRun>): ScriptRun =>
  ({
    id: 'r1',
    script_id: 'demo',
    structure_id: 's1',
    created_at: '2026-01-01T00:00:00Z',
    status: 'completed',
    job_id: 'j1',
    structure_ids: [],
    values: {},
    error: null,
    imported: true,
    ...over,
  }) as ScriptRun;

const errors: string[] = [];

beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
  useProjectStore.setState({
    info: { path: '/p', name: 'p', format_version: 1 } as never,
    structures: [{ id: 's1', name: 'water', formula: 'H2O', natoms: 3 } as never],
    // the panel refreshes the project after saving the document and after a run produces
    // structures; the real one would call the API, which is not what is under test here
    refresh: async () => undefined,
  });
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'water', charge: 0, atoms: [makeAtom('O', [0, 0, 0])] }));
  vi.spyOn(api.scripts, 'list').mockResolvedValue([script('demo', 'print(1)\n')]);
  vi.spyOn(api.scripts, 'examples').mockResolvedValue([script('example', '# example\n')]);
});

const panel = (): void => {
  render(<ScriptsPanel onError={(m) => void errors.push(m)} />);
};

test('asks for a project before offering an editor', async () => {
  useProjectStore.setState({ info: null, structures: [] });
  panel();
  expect(await screen.findByText(/Open or create a project first/)).toBeVisible();
  expect(screen.queryByLabelText('Script source')).toBeNull();
});

test('a chosen script is loaded into the editor and Save is only enabled once it changes', async () => {
  const put = vi.spyOn(api.scripts, 'put').mockResolvedValue(script('demo', 'x'));
  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  const editor = screen.getByLabelText('Script source');
  expect(editor).toHaveValue('print(1)\n');
  // nothing has changed yet, so there is nothing to save
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await userEvent.type(editor, 'print(2)');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(put).toHaveBeenCalled());
  expect(put.mock.calls[0]![1]).toContain('print(2)');
});

test('running stores the script, saves the structure on screen and passes its id', async () => {
  vi.spyOn(api.scripts, 'put').mockResolvedValue(script('demo', 'print(1)\n'));
  const putStructure = vi.spyOn(api.structures, 'put').mockResolvedValue({} as never);
  const start = vi.spyOn(api.scripts, 'run').mockResolvedValue(run({ status: 'queued' }));
  vi.spyOn(api.scripts, 'getRun').mockResolvedValue(run({ values: { formula: 'H2O' } }));
  vi.spyOn(api.scripts, 'runLog').mockImplementation(async (_id, stream) => ({
    stream,
    lines: stream === 'stdout' ? ['hello from python'] : [],
  }));

  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  await userEvent.click(screen.getByRole('button', { name: 'Run' }));

  await waitFor(() => expect(start).toHaveBeenCalled());
  // the document is upserted first, because the project is how the script receives it
  expect(putStructure).toHaveBeenCalled();
  const docId = useStructureStore.getState().doc.id;
  expect(start.mock.calls[0]![1]).toBe(docId);
  // stdout appears, and the values the script emitted are shown
  expect(await screen.findByText('hello from python')).toBeVisible();
  expect(await screen.findByText('formula')).toBeVisible();
  expect(await screen.findByText('H2O')).toBeVisible();
  expect(errors).toEqual([]);
});

test('choosing no structure runs the script without one', async () => {
  vi.spyOn(api.scripts, 'put').mockResolvedValue(script('demo', ''));
  const putStructure = vi.spyOn(api.structures, 'put').mockResolvedValue({} as never);
  const start = vi.spyOn(api.scripts, 'run').mockResolvedValue(run({ status: 'completed' }));
  vi.spyOn(api.scripts, 'getRun').mockResolvedValue(run({}));
  vi.spyOn(api.scripts, 'runLog').mockResolvedValue({ stream: 'stdout', lines: [] });

  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  await userEvent.selectOptions(screen.getByLabelText('input'), 'none');
  await userEvent.click(screen.getByRole('button', { name: 'Run' }));

  await waitFor(() => expect(start).toHaveBeenCalled());
  expect(start.mock.calls[0]![1]).toBeNull();
  expect(putStructure).not.toHaveBeenCalled();
});

test('a traceback is shown and the run is marked failed', async () => {
  vi.spyOn(api.scripts, 'put').mockResolvedValue(script('demo', ''));
  vi.spyOn(api.structures, 'put').mockResolvedValue({} as never);
  vi.spyOn(api.scripts, 'run').mockResolvedValue(run({ status: 'queued' }));
  vi.spyOn(api.scripts, 'getRun').mockResolvedValue(
    run({
      status: 'failed',
      error: { type: 'ValueError', message: 'deliberate', traceback: 'Traceback...' },
    }),
  );
  vi.spyOn(api.scripts, 'runLog').mockImplementation(async (_id, stream) => ({
    stream,
    lines: stream === 'stderr' ? ['Traceback (most recent call last):'] : [],
  }));

  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  await userEvent.click(screen.getByRole('button', { name: 'Run' }));

  expect(await screen.findByText('ValueError: deliberate')).toBeVisible();
  expect(await screen.findByText(/Traceback \(most recent call last\)/)).toBeVisible();
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('failed');
});

test('a structure the script saved can be opened into the viewport', async () => {
  vi.spyOn(api.scripts, 'put').mockResolvedValue(script('demo', ''));
  vi.spyOn(api.structures, 'put').mockResolvedValue({} as never);
  vi.spyOn(api.scripts, 'run').mockResolvedValue(run({ status: 'queued' }));
  vi.spyOn(api.scripts, 'getRun').mockResolvedValue(run({ structure_ids: ['out1'] }));
  vi.spyOn(api.scripts, 'runLog').mockResolvedValue({ stream: 'stdout', lines: [] });
  const get = vi.spyOn(api.structures, 'get').mockResolvedValue(
    normalizeStructure({
      name: 'rattled',
      charge: 0,
      atoms: [makeAtom('He', [1, 1, 1])],
    }) as never,
  );

  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  await userEvent.click(screen.getByRole('button', { name: 'Run' }));

  const open = await screen.findByRole('button', { name: 'Open' });
  await userEvent.click(open);
  await waitFor(() => expect(get).toHaveBeenCalledWith('out1'));
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('rattled'));
});

test('Cancel is only offered while a script is running', async () => {
  vi.spyOn(api.scripts, 'put').mockResolvedValue(script('demo', ''));
  vi.spyOn(api.structures, 'put').mockResolvedValue({} as never);
  vi.spyOn(api.scripts, 'run').mockResolvedValue(run({ status: 'running' }));
  vi.spyOn(api.scripts, 'getRun').mockResolvedValue(run({ status: 'running' }));
  vi.spyOn(api.scripts, 'runLog').mockResolvedValue({ stream: 'stdout', lines: [] });
  const cancel = vi.spyOn(api.scripts, 'cancelRun').mockResolvedValue(run({ status: 'cancelled' }));

  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Run' }));

  const button = await screen.findByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('r1'));
});

test('an example is copied into a project script of its own name', async () => {
  const put = vi.spyOn(api.scripts, 'put').mockResolvedValue(script('example', '# example\n'));
  panel();
  await userEvent.selectOptions(await screen.findByLabelText('start from'), 'example');
  await waitFor(() => expect(put).toHaveBeenCalledWith('example', '# example\n'));
  await waitFor(() => expect(screen.getByLabelText('Script source')).toHaveValue('# example\n'));
});

test('Tab indents inside the editor instead of leaving it', async () => {
  vi.spyOn(api.scripts, 'list').mockResolvedValue([script('demo', 'if x:\n')]);
  panel();
  await userEvent.selectOptions(await screen.findByLabelText('script'), 'demo');
  const editor = screen.getByLabelText('Script source') as HTMLTextAreaElement;
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await userEvent.keyboard('{Tab}');
  // the caret is put back after the render, so the indent has to be awaited before typing on
  await waitFor(() => expect(editor.value).toBe('if x:\n    '));
  expect(editor).toHaveFocus();
  await userEvent.type(editor, 'pass');
  expect(editor.value).toBe('if x:\n    pass');
});
