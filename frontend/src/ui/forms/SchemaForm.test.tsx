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

const integerSchema: ParameterSchema = {
  id: 'i',
  backend: 'i',
  version: 1,
  title: 'I',
  sections: [
    {
      id: 's',
      label: 'Section',
      help: '',
      advanced: false,
      parameters: [
        {
          key: 'steps',
          label: 'Steps',
          type: 'integer',
          default: 10,
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [],
        },
        {
          key: 'kpoints',
          label: 'K-points',
          type: 'vector',
          default: [1, 1, 1],
          length: 3,
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: true,
          visible_when: [],
        },
      ],
    },
  ],
};

test('integer fields keep fractional input as text and show an inline error', () => {
  const changes: Record<string, unknown>[] = [];
  const { rerender } = render(
    <SchemaForm
      schema={integerSchema}
      values={{ steps: 10, kpoints: [1, 1, 1] }}
      onChange={(v) => changes.push(v)}
    />,
  );
  fireEvent.change(screen.getByLabelText('Steps'), { target: { value: '2.9' } });
  // not truncated to 2: the raw text is kept until it parses as a whole number
  expect(changes.at(-1)).toMatchObject({ steps: '2.9' });
  rerender(
    <SchemaForm
      schema={integerSchema}
      values={{ steps: '2.9', kpoints: [1, 1, 1] }}
      onChange={(v) => changes.push(v)}
    />,
  );
  expect(screen.getByLabelText('Steps')).toHaveValue(2.9);
  expect(screen.getByText('enter a whole number')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Steps'), { target: { value: '3' } });
  expect(changes.at(-1)).toMatchObject({ steps: 3 });
});

test('integer vectors reject fractional components', () => {
  const changes: Record<string, unknown>[] = [];
  const { rerender } = render(
    <SchemaForm
      schema={integerSchema}
      values={{ steps: 10, kpoints: [1, 1, 1] }}
      onChange={(v) => changes.push(v)}
    />,
  );
  fireEvent.change(screen.getByLabelText('K-points 2'), { target: { value: '1.5' } });
  expect(changes.at(-1)).toMatchObject({ kpoints: [1, '1.5', 1] });
  rerender(
    <SchemaForm
      schema={integerSchema}
      values={{ steps: 10, kpoints: [1, '1.5', 1] }}
      onChange={(v) => changes.push(v)}
    />,
  );
  expect(screen.getByText('enter a whole number')).toBeInTheDocument();
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

const gateSchema: ParameterSchema = {
  id: 'g',
  backend: 'g',
  version: 1,
  title: 'G',
  sections: [
    {
      id: 's',
      label: 'Section',
      help: '',
      advanced: false,
      parameters: [
        {
          key: 'detail',
          label: 'Set it in detail',
          type: 'boolean',
          default: false,
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [],
        },
        {
          key: 'quick',
          label: 'Quick list',
          type: 'string',
          default: '',
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [{ key: 'detail', op: 'falsy', value: null }],
        },
        {
          key: 'exact',
          label: 'Exact value',
          type: 'string',
          default: '',
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [{ key: 'detail', op: 'truthy', value: null }],
        },
      ],
    },
  ],
};

test('a boolean can show one field and hide another', () => {
  // the shape the GAMESS basis boxes use: a shorthand list, or the controls it stands for
  const { rerender } = render(
    <SchemaForm schema={gateSchema} values={{ detail: false }} onChange={() => {}} />,
  );
  expect(screen.getByLabelText('Quick list')).toBeInTheDocument();
  expect(screen.queryByLabelText('Exact value')).toBeNull();
  rerender(<SchemaForm schema={gateSchema} values={{ detail: true }} onChange={() => {}} />);
  expect(screen.queryByLabelText('Quick list')).toBeNull();
  expect(screen.getByLabelText('Exact value')).toBeInTheDocument();
});

const sectionSchema: ParameterSchema = {
  id: 'p',
  backend: 'p',
  version: 1,
  title: 'P',
  sections: [
    gateSchema.sections[0]!,
    {
      id: 'detail-only',
      label: 'Detailed settings',
      help: '',
      advanced: false,
      parameters: [
        {
          key: 'tolerance',
          label: 'Tolerance',
          type: 'string',
          default: '',
          required: false,
          advanced: false,
          help: '',
          exclusive_minimum: false,
          integer_vector: false,
          visible_when: [{ key: 'detail', op: 'truthy', value: null }],
        },
      ],
    },
  ],
};

test('a section whose fields are all hidden draws no heading', () => {
  // what keeps the per-program sections (GAMESS's five) out of every other program's form
  const { rerender } = render(
    <SchemaForm schema={sectionSchema} values={{ detail: false }} onChange={() => {}} />,
  );
  expect(screen.queryByText('Detailed settings')).toBeNull();
  rerender(<SchemaForm schema={sectionSchema} values={{ detail: true }} onChange={() => {}} />);
  expect(screen.getByText('Detailed settings')).toBeInTheDocument();
});
