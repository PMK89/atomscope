import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { atomColorArray, NO_ATOM_COLORS } from '../renderer/atomColors';
import { NO_STYLES, styleArray } from '../renderer/atomStyles';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import { useViewStore } from '../state/viewStore';
import { DisplayPanel } from './DisplayPanel';

beforeEach(() => {
  useViewStore.setState({
    style: 'ball-and-stick',
    selectionStyle: null,
    showRibbon: false,
    ribbonStyle: 'cartoon',
    showHBonds: false,
    multipleBonds: true,
    showLabels: false,
    atomLabels: 'symbol_index',
    bondLabels: 'none',
    labelShift: [0, 0, 0],
    showVectors: false,
    showUnitCell: false,
    showAxes: false,
  });
  useStructureStore
    .getState()
    .load(normalizeStructure({ name: 'c', atoms: [makeAtom('C', [0, 0, 0])] } as never));
});

test('the panel drives the display settings the renderer reads', () => {
  render(<DisplayPanel />);

  fireEvent.change(screen.getByLabelText('Display type'), { target: { value: 'vdw' } });
  expect(useViewStore.getState().style).toBe('vdw');

  fireEvent.change(screen.getByLabelText('Atom radius'), { target: { value: '0.6' } });
  expect(useViewStore.getState().atomScale).toBe(0.6);

  fireEvent.click(screen.getByLabelText('Show multiple bonds'));
  expect(useViewStore.getState().multipleBonds).toBe(false);

  fireEvent.click(screen.getByLabelText('Show axes'));
  expect(useViewStore.getState().showAxes).toBe(true);
});

test('the selection can be given its own display type', () => {
  render(<DisplayPanel />);
  expect(useViewStore.getState().selectionStyle).toBeNull();

  fireEvent.change(screen.getByLabelText('Selected atoms'), { target: { value: 'vdw' } });
  expect(useViewStore.getState().selectionStyle).toBe('vdw');

  fireEvent.change(screen.getByLabelText('Selected atoms'), { target: { value: '' } });
  expect(useViewStore.getState().selectionStyle).toBeNull();
});

test('choosing a label content switches the label layer on', () => {
  render(<DisplayPanel />);
  expect(useViewStore.getState().showLabels).toBe(false);

  fireEvent.change(screen.getByLabelText('Atoms'), { target: { value: 'partial_charge' } });
  const view = useViewStore.getState();
  expect(view.atomLabels).toBe('partial_charge');
  // picking a content is how a user asks for labels; requiring a second click would be a trap
  expect(view.showLabels).toBe(true);
});

test('label style controls are per-axis and independent', () => {
  render(<DisplayPanel />);
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: '1.2' } });
  fireEvent.change(screen.getByLabelText('Label shift y'), { target: { value: '0.5' } });
  fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#ff0000' } });

  const view = useViewStore.getState();
  expect(view.labelSize).toBe(1.2);
  expect(view.labelShift).toEqual([0, 0.5, 0]);
  expect(view.labelColor).toBe('#ff0000');
});

test('hydrogen bonds have their own cut-offs', () => {
  render(<DisplayPanel />);
  fireEvent.click(screen.getByLabelText('Enabled', { selector: '#display-hbonds' }));
  expect(useViewStore.getState().showHBonds).toBe(true);

  fireEvent.change(screen.getByLabelText('Cut-off distance (Å)'), { target: { value: '3.5' } });
  fireEvent.change(screen.getByLabelText('Cut-off angle (°)'), { target: { value: '140' } });
  const view = useViewStore.getState();
  expect(view.hbondDistance).toBe(3.5);
  expect(view.hbondAngle).toBe(140);
});

test('ribbons can be switched on and given a rendering', () => {
  render(<DisplayPanel />);
  fireEvent.click(screen.getByLabelText('Enabled', { selector: '#display-ribbon' }));
  expect(useViewStore.getState().showRibbon).toBe(true);

  fireEvent.change(screen.getByLabelText('Rendering'), { target: { value: 'backbone' } });
  expect(useViewStore.getState().ribbonStyle).toBe('backbone');
  // a structure without residues says why nothing is drawn
  expect(screen.getByText(/no residues, so it has no backbone/)).toBeInTheDocument();
});

test('the panel says when a setting has nothing to act on', () => {
  render(<DisplayPanel />);
  expect(screen.getByText(/carries no vector field/)).toBeInTheDocument();
  expect(screen.getByText('This structure has no unit cell.')).toBeInTheDocument();
});

test('display scope assigns a display type to the selection and hides the rest', () => {
  const doc = normalizeStructure({
    name: 'c3',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('O', [3, 0, 0])],
  } as never);
  useStructureStore.getState().load(doc);
  useViewStore.setState({ atomStyles: NO_STYLES });
  render(<DisplayPanel />);

  // with nothing selected there is nothing to scope, and no way to hide the whole structure
  expect(screen.getByRole('button', { name: 'Assign to selection' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Display only selection' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Show all' })).toBeDisabled();

  act(() => useSelectionStore.getState().set([1]));
  fireEvent.change(screen.getByLabelText('Display type to assign'), { target: { value: 'vdw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign to selection' }));
  expect(styleArray(doc, useViewStore.getState().atomStyles)).toEqual([null, 'vdw', null]);
  expect(screen.getByText(/1 of 3 atoms have a display type of their own/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Display only selection' }));
  expect(styleArray(doc, useViewStore.getState().atomStyles)).toEqual(['hidden', 'vdw', 'hidden']);
  expect(screen.getByText(/3 of 3 atoms .*, 2 of them hidden\./)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(styleArray(doc, useViewStore.getState().atomStyles)).toBeNull();
});

test('display scope gives the selection a colour of its own, over the scheme', () => {
  const doc = normalizeStructure({
    name: 'c3',
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('O', [3, 0, 0])],
  } as never);
  useStructureStore.getState().load(doc);
  useViewStore.setState({ atomColorOverrides: NO_ATOM_COLORS, colorScheme: 'element' });
  useSelectionStore.getState().clear();
  render(<DisplayPanel />);

  expect(screen.getByRole('button', { name: 'Colour selection' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Clear colours' })).toBeDisabled();
  expect(screen.getByText(/Every atom takes its colour from the scheme/)).toBeInTheDocument();

  act(() => useSelectionStore.getState().set([2]));
  fireEvent.change(screen.getByLabelText('Colour to assign'), { target: { value: '#ff8000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Colour selection' }));

  const colors = atomColorArray(null, doc, useViewStore.getState().atomColorOverrides)!;
  expect([...colors.slice(6, 9)].map((v) => Math.round(v * 255))).toEqual([255, 128, 0]);
  expect(screen.getByText(/1 of 3 atoms have a colour of their own/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Clear colours' }));
  expect(atomColorArray(null, doc, useViewStore.getState().atomColorOverrides)).toBeNull();
});

test('the colour schemes that need data say so, and one colour is chosen in the panel', () => {
  useViewStore.setState({ colorScheme: 'element', customColor: '#4aa3ff' });
  render(<DisplayPanel />);

  // a plain molecule: no residues and no charges, and each scheme says what it is missing
  fireEvent.change(screen.getByLabelText('Colour by', { selector: '#display-color-scheme' }), {
    target: { value: 'chain' },
  });
  expect(screen.getByText(/no residues, so its atoms keep/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Colour by', { selector: '#display-color-scheme' }), {
    target: { value: 'charge' },
  });
  expect(screen.getByText(/no partial charges/)).toBeInTheDocument();

  // the index scheme needs nothing, so it says nothing
  fireEvent.change(screen.getByLabelText('Colour by', { selector: '#display-color-scheme' }), {
    target: { value: 'index' },
  });
  expect(screen.queryByText(/no residues, so its atoms keep|no partial charges/)).toBeNull();

  fireEvent.change(screen.getByLabelText('Colour by', { selector: '#display-color-scheme' }), {
    target: { value: 'custom' },
  });
  fireEvent.change(screen.getByLabelText('Colour', { selector: '#display-custom-color' }), {
    target: { value: '#ff8000' },
  });
  expect(useViewStore.getState().customColor).toBe('#ff8000');
});

test('the residue palette is reachable from whichever engine is coloured by residue', () => {
  useViewStore.setState({
    colorScheme: 'element',
    residuePalette: 'amino',
    ribbonColorScheme: 'secondary',
    showRibbon: true,
  });
  render(<DisplayPanel />);
  // neither engine is on residues: nothing to choose
  expect(screen.queryByLabelText('Residue colours')).toBeNull();

  // the ribbon alone can be on residues, and the palette must be reachable there
  fireEvent.change(screen.getByLabelText('Colour by', { selector: '#display-ribbon-colorby' }), {
    target: { value: 'residue' },
  });
  fireEvent.change(
    screen.getByLabelText('Residue colours', { selector: '#display-ribbon-palette' }),
    { target: { value: 'shapely' } },
  );
  expect(useViewStore.getState().residuePalette).toBe('shapely');

  // with both on residues there are two selects showing the one setting
  fireEvent.change(screen.getByLabelText('Colour by', { selector: '#display-color-scheme' }), {
    target: { value: 'residue' },
  });
  const selects = screen.getAllByLabelText('Residue colours');
  expect(selects).toHaveLength(2);
  expect(selects.map((s) => (s as HTMLSelectElement).value)).toEqual(['shapely', 'shapely']);
});
