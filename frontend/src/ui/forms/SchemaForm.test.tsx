import { fireEvent, render, screen } from '@testing-library/react';
import type { ParameterSchema } from '../../api/client';
import { SchemaForm } from './SchemaForm';

const schema: ParameterSchema = {
  id: 't',
  backend: 't',
  version: 1,
  title: 'T',
  sections: [
    {
      id: 's',
      label: 'Section',
      help: '',
      advanced: false,
      parameters: [
        {
          key: 'task',
          label: 'Task',
          type: 'enum',
          default: 'a',
          choices: [
            { value: 'a', label: 'Alpha', help: '' },
            { value: 'b', label: 'Beta', help: '' },
          ],
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [],
        },
        {
          key: 'fmax',
          label: 'Fmax',
          type: 'number',
          default: 0.05,
          unit: 'eV/angstrom',
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [{ key: 'task', op: 'eq', value: 'b' }],
        },
        {
          key: 'seed',
          label: 'Seed',
          type: 'integer',
          default: 1,
          required: false,
          advanced: true,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [],
        },
      ],
    },
  ],
};

test('conditional visibility, advanced toggle and change propagation', () => {
  const changes: Record<string, unknown>[] = [];
  const { rerender } = render(
    <SchemaForm
      schema={schema}
      values={{ task: 'a', fmax: 0.05, seed: 1 }}
      onChange={(v) => changes.push(v)}
    />,
  );
  expect(screen.queryByLabelText('Fmax')).toBeNull();
  expect(screen.queryByLabelText('Seed')).toBeNull();
  fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'b' } });
  expect(changes[0]).toMatchObject({ task: 'b' });
  rerender(
    <SchemaForm
      schema={schema}
      values={{ task: 'b', fmax: 0.05, seed: 1 }}
      onChange={(v) => changes.push(v)}
    />,
  );
  expect(screen.getByLabelText('Fmax')).toBeInTheDocument();
  expect(screen.getByText('eV/angstrom')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Show advanced options'));
  expect(screen.getByLabelText('Seed')).toBeInTheDocument();
});

test('shows backend validation errors next to fields', () => {
  render(
    <SchemaForm
      schema={schema}
      values={{ task: 'b', fmax: -1 }}
      onChange={() => undefined}
      report={{ issues: [{ key: 'fmax', message: 'must be > 0', severity: 'error' }] }}
    />,
  );
  expect(screen.getByText('must be > 0')).toBeInTheDocument();
});
