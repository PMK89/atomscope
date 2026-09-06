import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useCrystalStore } from '../state/crystalStore';
import { useStructureStore } from '../state/structureStore';
import { useViewStore } from '../state/viewStore';

const { symmetry, wrap, supercell, library, libraryEntry, spacegroups, fill } = vi.hoisted(() => ({
  symmetry: vi.fn(),
  wrap: vi.fn(),
  supercell: vi.fn(),
  library: vi.fn(),
  libraryEntry: vi.fn(),
  spacegroups: vi.fn(),
  fill: vi.fn(),
}));
vi.mock('../api/client', () => ({
  api: { crystal: { symmetry, wrap, supercell, library, libraryEntry, spacegroups, fill } },
}));

import { CrystalDialogs } from './CrystalDialogs';
import { CrystalPanel } from './CrystalPanel';

const nacl = normalizeStructure({
  name: 'NaCl',
  charge: 0,
  cell: {
    vectors: [
      [5.64, 0, 0],
      [0, 5.64, 0],
      [0, 0, 5.64],
    ],
    pbc: [true, true, true],
  },
  atoms: [makeAtom('Na', [0, 0, 0]), makeAtom('Cl', [2.82, 2.82, 2.82])],
});

beforeEach(() => {
  useStructureStore.getState().load(nacl);
  useCrystalStore.setState({ dialog: null, symmetry: null, setting: null });
  vi.clearAllMocks();
});

test('shows cell parameters and perceives symmetry through the API', async () => {
  symmetry.mockResolvedValue({
    number: 225,
    international: 'Fm-3m',
    international_full: 'F 4/m -3 2/m',
    hall: '-F 4 2 3',
    hall_number: 523,
    point_group: 'm-3m',
    schoenflies: 'Oh^5',
    lattice_type: 'cubic',
    n_operations: 192,
    wyckoffs: ['a', 'b'],
    equivalent_atoms: [0, 1],
    n_asymmetric: 2,
    symprec: 0.001,
  });
  const onError = vi.fn();
  render(<CrystalPanel onError={onError} />);
  expect(screen.getByLabelText('Cell a')).toHaveValue('5.6400');
  expect(screen.getByLabelText('Cell gamma')).toHaveValue('90.0000');
  expect(screen.getByText(/cubic · V = 179.406 Å³/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Perceive'));
  await waitFor(() => expect(screen.getByText(/Fm-3m \(225\)/)).toBeInTheDocument());
  expect(symmetry).toHaveBeenCalledWith({ structure: nacl, symprec: 0.001 });
  expect(screen.getByLabelText('Fill cell (group)')).toHaveValue('225');
  expect(onError).not.toHaveBeenCalled();
});

test('fractional editor commits an undoable edit without the backend', () => {
  render(<CrystalPanel onError={vi.fn()} />);
  const ta = screen.getByLabelText('Fractional coordinates');
  expect((ta as HTMLTextAreaElement).value).toMatch(/Cl\s+0.50000\s+0.50000\s+0.50000/);
  fireEvent.change(ta, { target: { value: 'Na 0 0 0\nCl 0.25 0.25 0.25' } });
  fireEvent.click(screen.getByText('Apply fractional coordinates'));
  const st = useStructureStore.getState();
  expect(st.doc.atoms[1]!.position[0]).toBeCloseTo(1.41);
  expect(st.undoLabel()).toBe('Edit fractional coordinates');
});

test('wrap commits the structure returned by the backend', async () => {
  wrap.mockResolvedValue({ ...nacl, name: 'wrapped' });
  render(<CrystalPanel onError={vi.fn()} />);
  fireEvent.click(screen.getByText('Wrap atoms'));
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('wrapped'));
  expect(useStructureStore.getState().undoLabel()).toBe('Wrap atoms');
});

test('cell repeats drive the view store', () => {
  render(<CrystalPanel onError={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Repeat A'), { target: { value: '3' } });
  expect(useViewStore.getState().cellRepeat).toEqual([3, 1, 1]);
  fireEvent.change(screen.getByLabelText('Repeat B'), { target: { value: '' } });
  expect(useViewStore.getState().cellRepeat).toEqual([3, 1, 1]);
});

test('supercell dialog builds through the backend and closes', async () => {
  supercell.mockResolvedValue({ ...nacl, name: 'big' });
  render(<CrystalDialogs onError={vi.fn()} />);
  useCrystalStore.getState().openDialog('supercell');
  await waitFor(() =>
    expect(screen.getByRole('dialog', { name: 'Supercell' })).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText('Supercell c'), { target: { value: '1' } });
  fireEvent.click(screen.getByText('Build supercell'));
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('big'));
  expect(supercell).toHaveBeenCalledWith({ structure: nacl, repeat: [2, 2, 1] });
  expect(useCrystalStore.getState().dialog).toBeNull();
});

test('library dialog lists entries and loads one', async () => {
  library.mockResolvedValue([
    { category: 'halides', name: 'NaCl-Halite', formula: 'NaCl', readable: true },
    { category: 'oxides', name: 'MgO', formula: 'MgO', readable: true },
    { category: 'halides', name: 'Broken', formula: 'XY', readable: false },
  ]);
  libraryEntry.mockResolvedValue({ ...nacl, name: 'NaCl-Halite' });
  render(<CrystalDialogs onError={vi.fn()} />);
  useCrystalStore.getState().openDialog('library');
  await waitFor(() => expect(screen.getByText('NaCl-Halite')).toBeInTheDocument());
  expect(screen.queryByTitle('oxides/MgO')).not.toBeInTheDocument(); // other category
  expect(screen.getByText('Broken').closest('button')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mg' } });
  expect(screen.getByTitle('oxides/MgO')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
  fireEvent.click(screen.getByText('NaCl-Halite'));
  await waitFor(() => expect(useStructureStore.getState().doc.name).toBe('NaCl-Halite'));
  expect(libraryEntry).toHaveBeenCalledWith('halides', 'NaCl-Halite');
  expect(useCrystalStore.getState().dialog).toBeNull();
});

test('without a cell the panel offers to add one', () => {
  useStructureStore.getState().load(normalizeStructure({ name: 'mol', charge: 0 }));
  render(<CrystalPanel onError={vi.fn()} />);
  expect(screen.getByText('This structure has no unit cell.')).toBeInTheDocument();
  expect(screen.getByText('Add unit cell')).toBeInTheDocument();
});

const P2 = [
  {
    hall_number: 3,
    number: 3,
    international: 'P2',
    international_full: 'P 1 2 1',
    hall: 'P 2y',
    choice: 'b',
  },
  {
    hall_number: 4,
    number: 3,
    international: 'P2',
    international_full: 'P 1 1 2',
    hall: 'P 2',
    choice: 'c',
  },
  {
    hall_number: 523,
    number: 225,
    international: 'Fm-3m',
    international_full: 'F 4/m -3 2/m',
    hall: '-F 4 2 3',
    choice: '',
  },
];

test('the space-group table lists the settings, marks the perceived one and feeds Fill', async () => {
  spacegroups.mockResolvedValue(P2);
  fill.mockResolvedValue({ ...nacl, name: 'filled' });
  useCrystalStore.getState().setSymmetry(
    {
      number: 225,
      international: 'Fm-3m',
      international_full: 'F 4/m -3 2/m',
      hall: '-F 4 2 3',
      hall_number: 523,
      point_group: 'm-3m',
      schoenflies: 'Oh^5',
      lattice_type: 'cubic',
      n_operations: 192,
      wyckoffs: [],
      equivalent_atoms: [],
      n_asymmetric: 2,
      symprec: 0.001,
    } as never,
    useStructureStore.getState().revision,
  );
  render(<CrystalDialogs onError={vi.fn()} />);
  useCrystalStore.getState().openDialog('spacegroup');

  await waitFor(() => expect(screen.getByLabelText('Space groups')).toBeInTheDocument());
  // one row per setting, so a group with three of them is three rows, not one
  expect(screen.getAllByText('P 2y')).toHaveLength(1);
  expect(screen.getByText('F 4/m -3 2/m').closest('tr')).toHaveClass('selected');
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'P 2' } });
  expect(screen.queryByText('F 4/m -3 2/m')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Set P 1 1 2 (Hall 4)'));
  expect(useCrystalStore.getState().setting?.hall_number).toBe(4);
  expect(useCrystalStore.getState().dialog).toBeNull();

  // the panel now fills by that setting rather than by a number ASE would settle itself
  render(<CrystalPanel onError={vi.fn()} />);
  expect(screen.getByText(/P 1 1 2 \(no\. 3, Hall P 2, setting c\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Fill'));
  await waitFor(() => expect(fill).toHaveBeenCalled());
  expect(fill.mock.calls[0]![0]).toMatchObject({ hall_number: 4 });
  expect(fill.mock.calls[0]![0]).not.toHaveProperty('spacegroup');
});

test('a typed number is used when no setting is chosen, and Clear goes back to one', async () => {
  fill.mockResolvedValue(nacl);
  render(<CrystalPanel onError={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Fill cell (group)'), { target: { value: '225' } });
  fireEvent.click(screen.getByText('Fill'));
  await waitFor(() => expect(fill).toHaveBeenCalled());
  expect(fill.mock.calls[0]![0]).toMatchObject({ spacegroup: 225 });

  act(() => useCrystalStore.getState().setSetting(P2[0] as never));
  expect(screen.getByLabelText('Fill cell (group)')).toBeDisabled();
  fireEvent.click(screen.getByText('Clear'));
  expect(useCrystalStore.getState().setting).toBeNull();
  expect(screen.getByLabelText('Fill cell (group)')).toBeEnabled();
});
