import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { makeAtom, normalizeStructure } from '../model/structure';
import { useSpectrumStore } from '../state/spectrumStore';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';

const { vibrations, vibrationalSpectrum, importSpectrumUpload } = vi.hoisted(() => ({
  vibrations: vi.fn(),
  vibrationalSpectrum: vi.fn(),
  importSpectrumUpload: vi.fn(),
}));
vi.mock('../api/client', () => ({
  api: {
    analysis: { vibrations, vibrationalSpectrum },
    io: { importSpectrumUpload, importVibrationsUpload: vi.fn() },
  },
}));

import { SpectrumPanel } from './SpectrumPanel';

const water = normalizeStructure({
  name: 'water',
  charge: 0,
  atoms: [
    makeAtom('O', [0, 0, 0.117]),
    makeAtom('H', [0, 0.757, -0.469]),
    makeAtom('H', [0, -0.757, -0.469]),
  ],
});

const MODES = [
  {
    frequency: 1595.3,
    displacements: [
      [0, 0, -0.0669],
      [0, 0.4176, 0.5308],
      [0, -0.4176, 0.5308],
    ] as [number, number, number][],
    ir_intensity: 62.1,
    symmetry: 'A1',
    kind: 'vibration',
  },
  {
    frequency: 3657.1,
    displacements: [
      [0, 0, 0.0472],
      [0, 0.5793, -0.3745],
      [0, -0.5793, -0.3745],
    ] as [number, number, number][],
    ir_intensity: 5.4,
    symmetry: 'A1',
    kind: 'vibration',
  },
];

const VIBRATIONS = {
  id: 'v1',
  symbols: ['O', 'H', 'H'],
  positions: [
    [0, 0, 0.117],
    [0, 0.757, -0.469],
    [0, -0.757, -0.469],
  ] as [number, number, number][],
  modes: MODES,
  trivial_modes: [],
  zero_point_energy: 0.3255,
  linear: false,
  method: 'MMFF94 (Open Babel); IR intensities ... (approximate)',
};

const IR_SPECTRUM = {
  id: 'ir1',
  kind: 'ir' as const,
  name: 'IR spectrum',
  x: { label: 'wavenumber', unit: 'cm^-1', descending: true },
  y: { label: 'IR intensity', unit: 'km/mol' },
  peaks: [
    { x: 1595.3, intensity: 62.1, source_index: 0 },
    { x: 3657.1, intensity: 5.4, source_index: 1 },
  ],
  x_values: [1500, 2000, 2500, 3000, 3700],
  y_values: [1, 0.2, 0.1, 0.2, 1],
  line_shape: 'gaussian' as const,
  width: 30,
};

beforeEach(() => {
  useStructureStore.getState().load(water);
  useTrajectoryStore.getState().clear();
  useSpectrumStore.setState({
    vibrations: null,
    source: null,
    spectra: [],
    activeSpectrumId: null,
    overlayId: null,
    selectedMode: -1,
    busy: null,
  });
  vi.clearAllMocks();
});

test('computes modes and lists them with frequency, intensity and symmetry', async () => {
  vibrations.mockResolvedValue({
    vibrations: VIBRATIONS,
    structure: { ...water, name: 'water' },
    ir: IR_SPECTRUM,
  });
  const onError = vi.fn();
  render(<SpectrumPanel onError={onError} />);

  expect(screen.getByText('No spectrum yet. Compute modes or import a file.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));

  await waitFor(() => expect(screen.getByLabelText('normal modes')).toBeInTheDocument());
  expect(vibrations).toHaveBeenCalledWith(
    expect.objectContaining({ calculator: 'openbabel', force_field: 'MMFF94' }),
  );
  const rows = screen.getAllByRole('row').slice(1); // drop the header row
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('1595.3');
  expect(rows[0]).toHaveTextContent('62.10');
  expect(rows[0]).toHaveTextContent('A1');
  expect(screen.getByText(/ZPE 0.3255 eV/)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'IR spectrum' })).toBeInTheDocument();
  expect(onError).not.toHaveBeenCalled();
});

test('the computed geometry is committed as one undo step', async () => {
  vibrations.mockResolvedValue({
    vibrations: VIBRATIONS,
    structure: {
      ...water,
      atoms: [
        makeAtom('O', [0, 0, 0.12]),
        makeAtom('H', [0, 0.76, -0.47]),
        makeAtom('H', [0, -0.76, -0.47]),
      ],
    },
    ir: IR_SPECTRUM,
  });
  render(<SpectrumPanel onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));

  await waitFor(() => expect(useStructureStore.getState().canUndo()).toBe(true));
  expect(useStructureStore.getState().undoLabel()).toBe('vibrational analysis geometry');
  expect(useStructureStore.getState().doc.atoms[0]!.position[2]).toBeCloseTo(0.12);
  // atom identities survive the geometry swap
  expect(useStructureStore.getState().doc.atoms[0]!.uid).toBe(water.atoms[0]!.uid);
});

test('selecting a mode and pressing Animate loads a vibration trajectory; Stop clears it', async () => {
  vibrations.mockResolvedValue({
    vibrations: VIBRATIONS,
    structure: water,
    ir: IR_SPECTRUM,
  });
  render(<SpectrumPanel onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));
  await waitFor(() => expect(screen.getByLabelText('normal modes')).toBeInTheDocument());

  fireEvent.click(screen.getAllByRole('row')[2]!); // the 3657 cm-1 mode
  expect(useSpectrumStore.getState().selectedMode).toBe(1);

  fireEvent.click(screen.getByRole('button', { name: 'Animate' }));
  const t = useTrajectoryStore.getState().trajectory;
  expect(t?.kind).toBe('vibration');
  expect(t?.nAtoms).toBe(3);
  expect(t?.nFrames).toBe(useSpectrumStore.getState().framesPerPeriod);
  expect(useTrajectoryStore.getState().playing).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(useTrajectoryStore.getState().trajectory).toBeNull();
});

test('re-broadening posts the chosen line shape and width', async () => {
  vibrations.mockResolvedValue({ vibrations: VIBRATIONS, structure: water, ir: IR_SPECTRUM });
  vibrationalSpectrum.mockResolvedValue({ ...IR_SPECTRUM, id: 'ir2', line_shape: 'lorentzian' });
  render(<SpectrumPanel onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));
  await waitFor(() => expect(screen.getByLabelText('normal modes')).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText('Line shape'), { target: { value: 'lorentzian' } });
  fireEvent.change(screen.getByLabelText('Width (FWHM)'), { target: { value: '12' } });
  fireEvent.click(screen.getByLabelText('Transmittance (instead of absorbance)'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply broadening' }));

  await waitFor(() =>
    expect(vibrationalSpectrum).toHaveBeenCalledWith(
      expect.objectContaining({ shape: 'lorentzian', width: 12, transmittance: true }),
    ),
  );
});

test('an imported experimental spectrum becomes the overlay', async () => {
  importSpectrumUpload.mockResolvedValue({
    id: 'exp1',
    kind: 'experimental',
    name: 'METHANOL',
    x: { label: 'wavenumber', unit: 'cm^-1', descending: true },
    y: { label: 'transmittance', unit: '%' },
    x_values: [1500, 2000, 3700],
    y_values: [0.5, 0.9, 0.3],
  });
  render(<SpectrumPanel onError={vi.fn()} />);
  const input = screen.getByLabelText('import experimental spectrum');
  fireEvent.change(input, {
    target: { files: [new File(['1 2\n'], 'methanol.jdx', { type: 'text/plain' })] },
  });

  await waitFor(() => expect(useSpectrumStore.getState().overlayId).toBe('exp1'));
  expect(useSpectrumStore.getState().spectra).toHaveLength(1);
  expect(screen.getByRole('img', { name: 'METHANOL' })).toBeInTheDocument();
});

test('a failing computation is reported through onError and does not crash the panel', async () => {
  vibrations.mockRejectedValue(new Error('MMFF94 could not be set up for XeF4'));
  const onError = vi.fn();
  render(<SpectrumPanel onError={onError} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));

  await waitFor(() => expect(onError).toHaveBeenCalledWith('MMFF94 could not be set up for XeF4'));
  expect(screen.queryByLabelText('normal modes')).not.toBeInTheDocument();
  expect(useSpectrumStore.getState().busy).toBeNull();
});

/** The href and file name of the download an export triggers. */
function captureDownload(run: () => void): { href: string; name: string } {
  let captured = { href: '', name: '' };
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    captured = { href: this.href, name: this.download };
  });
  run();
  click.mockRestore();
  return captured;
}

const text = (href: string): string => decodeURIComponent(href.split(',').slice(1).join(','));

test('the plotted curve and the mode table export as tab-separated values', async () => {
  vibrations.mockResolvedValue({ vibrations: VIBRATIONS, structure: water, ir: IR_SPECTRUM });
  render(<SpectrumPanel onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));
  await waitFor(() => expect(screen.getByLabelText('normal modes')).toBeInTheDocument());

  const data = captureDownload(() =>
    fireEvent.click(screen.getByRole('button', { name: 'Export data (TSV)' })),
  );
  expect(data.name).toBe('IR_spectrum.tsv');
  expect(data.href.startsWith('data:text/tab-separated-values;charset=utf-8,')).toBe(true);
  expect(text(data.href)).toBe(
    'wavenumber [cm^-1]\tIR intensity [km/mol]\n1500\t1\n2000\t0.2\n2500\t0.1\n3000\t0.2\n3700\t1\n',
  );

  const modes = captureDownload(() =>
    fireEvent.click(screen.getByRole('button', { name: 'Export modes (TSV)' })),
  );
  expect(modes.name).toMatch(/-modes\.tsv$/);
  expect(text(modes.href).split('\n')[1]).toBe('1\t1595.30\t62.10\t-\t-\t-\tA1');
});

test('the chart exports as a standalone SVG named after the spectrum', async () => {
  vibrations.mockResolvedValue({ vibrations: VIBRATIONS, structure: water, ir: IR_SPECTRUM });
  render(<SpectrumPanel onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compute modes' }));
  await waitFor(() => expect(screen.getByRole('img', { name: 'IR spectrum' })).toBeInTheDocument());

  const image = captureDownload(() =>
    fireEvent.click(screen.getByRole('button', { name: 'Export image (SVG)' })),
  );
  expect(image.name).toBe('IR_spectrum.svg');
  expect(image.href.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  const markup = text(image.href);
  expect(markup).toContain('<svg');
  expect(markup).toContain('IR spectrum');
  expect(markup).not.toContain('var(--');
});
