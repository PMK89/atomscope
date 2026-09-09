import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { api, type Calculation, type ParameterSchema } from '../api/client';
import { useCalculationStore } from '../state/calculationStore';
import { NewSweep, numericParameters, parseValues } from './NewSweep';

const SCHEMA = {
  id: 'cppaw',
  label: 'CP-PAW',
  sections: [
    {
      id: 'basis',
      label: 'Basis',
      advanced: false,
      help: '',
      parameters: [
        { key: 'epwpsi', label: 'Wave-function cutoff', type: 'number', unit: 'rydberg' },
        { key: 'nstep', label: 'Iterations', type: 'integer' },
        { key: 'task', label: 'Task', type: 'enum', choices: [] },
      ],
    },
  ],
} as unknown as ParameterSchema;

const calc = (over: Partial<Calculation> = {}): Calculation =>
  ({
    id: 'c1',
    name: 'iron reference',
    backend_id: 'cppaw',
    structure_id: 's1',
    status: 'completed',
    values: { epwpsi: 30, nstep: 200 },
    ...over,
  }) as Calculation;

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
  useCalculationStore.setState({ schemas: { cppaw: SCHEMA } });
});

test('a value list is read as a list or as from:to:step', () => {
  expect(parseValues('20 30 40')).toEqual([20, 30, 40]);
  expect(parseValues('20, 30,40')).toEqual([20, 30, 40]);
  expect(parseValues('20:50:10')).toEqual([20, 30, 40, 50]);
  // a step that does not divide the range stops inside it rather than overshooting
  expect(parseValues('94:106:4')).toEqual([94, 98, 102, 106]);
  expect(parseValues('0.9:1.1:0.1')).toEqual([0.9, 1, 1.1]);
  // nonsense gives nothing rather than NaN points or an endless loop
  expect(parseValues('')).toEqual([]);
  expect(parseValues('a b')).toEqual([]);
  expect(parseValues('20:50')).toEqual([]);
  expect(parseValues('50:20:10')).toEqual([]);
  expect(parseValues('20:50:0')).toEqual([]);
});

test('only numeric parameters can be swept', () => {
  const keys = numericParameters(SCHEMA.sections).map((p) => p.key);
  // a curve needs a number on its x axis, so the enum is not offered. The type names are the
  // schema's: 'number' and 'integer', not 'float' and 'int' -- which is what this pins.
  expect(keys).toEqual(['epwpsi', 'nstep']);
});

test('the form is closed until asked for, and needs a calculation to vary', async () => {
  render(<NewSweep calculations={[]} onCreated={() => {}} onError={(m) => void errors.push(m)} />);
  expect(screen.getByRole('button', { name: 'New sweep…' })).toBeDisabled();
  expect(screen.getByText(/set one up first/)).toBeVisible();
});

test('creating a sweep sends the base calculation values and the points', async () => {
  const create = vi.spyOn(api.sweeps, 'create').mockResolvedValue([] as never);
  const onCreated = vi.fn();
  render(
    <NewSweep calculations={[calc()]} onCreated={onCreated} onError={(m) => void errors.push(m)} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'New sweep…' }));
  await waitFor(() => expect(screen.getByLabelText('Parameter')).toHaveValue('epwpsi'));
  await userEvent.type(screen.getByLabelText('Values'), '20 30 40 50');
  expect(screen.getByText(/4 points: 20, 30, 40, 50/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Create sweep' }));

  await waitFor(() => expect(create).toHaveBeenCalled());
  const body = create.mock.calls[0]![0] as {
    structure_id: string;
    spec: Record<string, unknown>;
  };
  expect(body.structure_id).toBe('s1');
  expect(body.spec['backend_id']).toBe('cppaw');
  expect(body.spec['key']).toBe('epwpsi');
  expect(body.spec['unit']).toBe('rydberg');
  // every other parameter of the reference calculation comes along
  expect(body.spec['base_values']).toEqual({ epwpsi: 30, nstep: 200 });
  expect(body.spec['points']).toEqual([
    { x: 20, values: { epwpsi: 20 } },
    { x: 30, values: { epwpsi: 30 } },
    { x: 40, values: { epwpsi: 40 } },
    { x: 50, values: { epwpsi: 50 } },
  ]);
  // off by default: independent runs, which is what most scans want
  expect(body.spec['restart_from']).toBeNull();
  expect(onCreated).toHaveBeenCalled();
  expect(errors).toEqual([]);
});

test('the restart option names the calculation every point continues from', async () => {
  const create = vi.spyOn(api.sweeps, 'create').mockResolvedValue([] as never);
  render(
    <NewSweep calculations={[calc()]} onCreated={() => {}} onError={(m) => void errors.push(m)} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'New sweep…' }));
  await waitFor(() => expect(screen.getByLabelText('Parameter')).toHaveValue('epwpsi'));
  await userEvent.type(screen.getByLabelText('Values'), '20:50:10');
  await userEvent.click(screen.getByLabelText('Continue each point from this calculation'));
  await userEvent.click(screen.getByRole('button', { name: 'Create sweep' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const spec = (create.mock.calls[0]![0] as { spec: Record<string, unknown> }).spec;
  expect(spec['restart_from']).toBe('c1');
});

test('fewer than two values is refused before anything is posted', async () => {
  const create = vi.spyOn(api.sweeps, 'create');
  render(
    <NewSweep calculations={[calc()]} onCreated={() => {}} onError={(m) => void errors.push(m)} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'New sweep…' }));
  await waitFor(() => expect(screen.getByLabelText('Parameter')).toHaveValue('epwpsi'));
  await userEvent.type(screen.getByLabelText('Values'), '30');
  // the button is disabled rather than failing at the request
  expect(screen.getByRole('button', { name: 'Create sweep' })).toBeDisabled();
  expect(create).not.toHaveBeenCalled();
});

test('the name defaults to the calculation and the parameter', async () => {
  render(
    <NewSweep calculations={[calc()]} onCreated={() => {}} onError={(m) => void errors.push(m)} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'New sweep…' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'placeholder',
      'iron reference vs Wave-function cutoff',
    ),
  );
});
