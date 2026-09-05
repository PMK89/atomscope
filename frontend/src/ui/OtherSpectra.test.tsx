import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { useSpectrumStore } from '../state/spectrumStore';
import { OtherSpectra } from './OtherSpectra';

const SPECTRUM = {
  id: 'sp1',
  kind: 'nmr',
  name: 'H NMR',
  x: { label: 'shift', unit: 'ppm' },
  y: { label: 'intensity', unit: '' },
  peaks: [],
  x_values: [0, 1],
  y_values: [0, 1],
};

beforeEach(() => {
  vi.restoreAllMocks();
  useSpectrumStore.setState({ shieldings: [], transitions: [], spectra: [] });
});

test('nothing is shown when the import carried neither shieldings nor transitions', () => {
  const { container } = render(<OtherSpectra onError={() => {}} />);
  expect(container.textContent).toBe('');
});

test('plots the chosen nucleus with the given reference', async () => {
  const nmr = vi.spyOn(api.analysis, 'nmr').mockResolvedValue(SPECTRUM as never);
  useSpectrumStore.setState({
    shieldings: [
      { element: 'H', index: 0, isotropic: 31.2 },
      { element: 'C', index: 1, isotropic: 150.0 },
    ] as never,
  });

  render(<OtherSpectra onError={() => {}} />);
  fireEvent.change(screen.getByLabelText('Nucleus'), { target: { value: 'C' } });
  fireEvent.change(screen.getByLabelText('Reference (ppm)'), { target: { value: '188.1' } });
  fireEvent.click(screen.getByText('Plot NMR'));

  await waitFor(() => expect(nmr).toHaveBeenCalled());
  expect(nmr).toHaveBeenCalledWith(expect.objectContaining({ element: 'C', reference: 188.1 }));
  expect(useSpectrumStore.getState().spectra).toHaveLength(1);
});

test('the electronic button switches between absorption and circular dichroism', async () => {
  const electronic = vi
    .spyOn(api.analysis, 'electronic')
    .mockResolvedValue({ ...SPECTRUM, kind: 'uvvis' } as never);
  useSpectrumStore.setState({
    transitions: [{ energy: 3.1, wavelength: 400, oscillator_strength: 0.4 }] as never,
  });

  render(<OtherSpectra onError={() => {}} />);
  fireEvent.click(screen.getByText('Plot UV-Vis'));
  await waitFor(() => expect(electronic).toHaveBeenCalled());
  expect(electronic.mock.calls[0]![0]).toMatchObject({ circular_dichroism: false });

  fireEvent.click(screen.getByLabelText('Circular dichroism'));
  fireEvent.click(screen.getByText('Plot CD'));
  await waitFor(() => expect(electronic).toHaveBeenCalledTimes(2));
  expect(electronic.mock.calls[1]![0]).toMatchObject({ circular_dichroism: true });
});

test('a failed request is reported', async () => {
  vi.spyOn(api.analysis, 'nmr').mockRejectedValue(new Error('no shieldings for Fe'));
  useSpectrumStore.setState({ shieldings: [{ element: 'Fe', index: 0, isotropic: 1 }] as never });
  const onError = vi.fn();

  render(<OtherSpectra onError={onError} />);
  fireEvent.click(screen.getByText('Plot NMR'));
  await waitFor(() => expect(onError).toHaveBeenCalledWith('no shieldings for Fe'));
});
