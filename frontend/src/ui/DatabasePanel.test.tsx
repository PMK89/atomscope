import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { api, type DatabaseRow } from '../api/client';
import { DatabasePanel } from './DatabasePanel';
import { useCalculationStore } from '../state/calculationStore';

const row = (over: Partial<DatabaseRow>): DatabaseRow =>
  ({
    id: 1,
    calculation_id: 'c1',
    name: 'iron-reference',
    formula: 'Fe',
    natoms: 1,
    energy: -599.2178,
    charge: null,
    magmom: null,
    backend: 'cppaw',
    status: 'completed',
    keys: { epwpsi: 30, spin_polarized: false },
    ...over,
  }) as DatabaseRow;

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(api.database, 'path').mockResolvedValue({
    path: '/p/atomscope.db',
    exists: true,
    name: 'atomscope.db',
  });
});

test('lists what is indexed and says where the file is', async () => {
  vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [row({}), row({ id: 2, name: 'water-relax', formula: 'H2O', natoms: 3, energy: -471 })],
    total: 2,
    selection: null,
  } as never);

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);

  expect(await screen.findByText('2 calculations')).toBeVisible();
  expect(screen.getByText('iron-reference')).toBeVisible();
  expect(screen.getByText('H2O')).toBeVisible();
  expect(screen.getByText('-599.218')).toBeVisible(); // eV, as ASE stores it
  expect(screen.getByText('/p/atomscope.db')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sends the selection string through unchanged', async () => {
  const select = vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [row({})],
    total: 22,
    selection: 'Fe,epwpsi=30',
  } as never);

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);
  await screen.findByText('22 calculations');

  await userEvent.type(screen.getByLabelText('Selection'), 'Fe,epwpsi=30');
  await userEvent.click(screen.getByRole('button', { name: 'Select' }));

  // exactly what was typed: the panel does not build a query of its own
  expect(select).toHaveBeenLastCalledWith('Fe,epwpsi=30');
  expect(await screen.findByRole('status')).toHaveTextContent('1 of 22 match Fe,epwpsi=30');
});

test('an example is a button, because the syntax is worth learning by using it', async () => {
  const select = vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [],
    total: 5,
    selection: null,
  } as never);

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);
  await screen.findByText('5 calculations');

  await userEvent.click(screen.getByTitle('contains both iron and oxygen'));
  expect(select).toHaveBeenLastCalledWith('Fe,O');
  // a bare word means "has this key" in ase.db, so nothing matching is not an error
  expect(await screen.findByRole('status')).toHaveTextContent('has this key');
});

test('an empty database says how to fill it rather than showing an empty table', async () => {
  vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [],
    total: 0,
    selection: null,
  } as never);
  vi.spyOn(api.database, 'path').mockResolvedValue({
    path: '/p/atomscope.db',
    exists: false,
    name: 'atomscope.db',
  });

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);
  expect(await screen.findByText(/No calculations indexed yet/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Rebuild' })).toBeVisible();
  expect(screen.queryByRole('table')).toBeNull();
});

test('rebuilding reports the calculations it could not index', async () => {
  vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [],
    total: 0,
    selection: null,
  } as never);
  vi.spyOn(api.database, 'reindex').mockResolvedValue({
    indexed: 3,
    problems: ['water-relax: Bad key: natoms'],
  } as never);

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);
  await screen.findByText(/No calculations indexed yet/);
  await userEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

  // a database quietly missing rows answers a query with the wrong ones, so this must surface
  await waitFor(() => expect(errors).toEqual(['water-relax: Bad key: natoms']));
});

test('a row opens its calculation, so Analysis can show the results', async () => {
  vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [row({})],
    total: 1,
    selection: null,
  } as never);
  const select = vi.spyOn(useCalculationStore.getState(), 'select');

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);
  await userEvent.click(await screen.findByRole('button', { name: 'iron-reference' }));

  expect(select).toHaveBeenCalledWith('c1');
});

test('shows charge and moment, which are the two the query language asks about', async () => {
  vi.spyOn(api.database, 'select').mockResolvedValue({
    rows: [row({ name: 'anion', charge: -1, magmom: 2 })],
    total: 1,
    selection: null,
  } as never);

  render(<DatabasePanel onError={(m) => void errors.push(m)} />);
  await screen.findByText('anion');
  expect(screen.getByText('-1.00')).toBeVisible();
  expect(screen.getByText('2.00')).toBeVisible();
  // and they are offered as example selections
  expect(screen.getByTitle('singly charged anions')).toBeVisible();
  expect(screen.getByTitle('has a magnetic moment')).toBeVisible();
});
