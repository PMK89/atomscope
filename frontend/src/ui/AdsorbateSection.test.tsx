import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { api, type AdsorptionSite } from '../api/client';
import { makeAtom, normalizeStructure, type StructureDoc } from '../model/structure';
import { useProjectStore } from '../state/projectStore';
import { useStructureStore } from '../state/structureStore';
import { AdsorbateSection } from './AdsorbateSection';

const SITES: AdsorptionSite[] = [
  { name: 'bridge', fractional: [0.5, 0], cartesian: [1.28, 0] },
  { name: 'fcc', fractional: [1 / 3, 1 / 3], cartesian: [1.28, 0.74] },
  { name: 'ontop', fractional: [0, 0], cartesian: [0, 0] },
];

const slab = (withSurface = true): StructureDoc =>
  normalizeStructure({
    name: 'Cu(111)',
    charge: 0,
    atoms: [makeAtom('Cu', [0, 0, 0]), makeAtom('Cu', [1.28, 0.74, 2.08])],
    cell: {
      vectors: [
        [2.55, 0, 0],
        [1.28, 2.21, 0],
        [0, 0, 14],
      ],
      pbc: [true, true, false],
    },
    surface: withSurface
      ? {
          cell: [
            [2.55, 0],
            [1.28, 2.21],
          ],
          sites: { bridge: [0.5, 0], fcc: [1 / 3, 1 / 3], ontop: [0, 0] },
          top_layer_atom_index: 1,
        }
      : null,
  } as never);

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
  useProjectStore.setState({ info: null, structures: [], refresh: async () => undefined });
  vi.spyOn(api.crystal, 'adsorbateNames').mockResolvedValue(['CO', 'H2O', 'NH3']);
  vi.spyOn(api.crystal, 'adsorptionSites').mockResolvedValue(SITES);
});

const section = (doc = slab()): void => {
  useStructureStore.getState().load(doc);
  render(<AdsorbateSection doc={doc} onError={(m) => void errors.push(m)} />);
};

test('a structure without named sites gets no section at all', () => {
  const { container } = render(
    <AdsorbateSection doc={slab(false)} onError={(m) => void errors.push(m)} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('the sites are offered with the positions they sit at', async () => {
  section();
  const select = await screen.findByLabelText('Site');
  await waitFor(() => expect(select).toHaveValue('bridge'));
  expect(screen.getByRole('option', { name: /^fcc/ })).toBeVisible();
  // the Cartesian position is shown, because "fcc" alone says nothing about where it is
  expect(screen.getByRole('option', { name: 'fcc (1.28, 0.74 Å)' })).toBeVisible();
  expect(await screen.findByText(/3 named sites/)).toBeVisible();
});

test('adding an adsorbate posts the site, the height and the structure', async () => {
  const adsorb = vi
    .spyOn(api.crystal, 'adsorbate')
    .mockResolvedValue(normalizeStructure({ name: 'Cu(111) + O (fcc)', charge: 0 }) as never);
  section();
  await waitFor(() => expect(screen.getByLabelText('Site')).toHaveValue('bridge'));
  await userEvent.selectOptions(screen.getByLabelText('Site'), 'fcc');
  await userEvent.click(screen.getByRole('button', { name: 'Add adsorbate' }));

  await waitFor(() => expect(adsorb).toHaveBeenCalled());
  const body = adsorb.mock.calls[0]![0] as Record<string, unknown>;
  expect(body['site']).toBe('fcc');
  expect(body['adsorbate']).toBe('O');
  expect(body['height']).toBe(1.7);
  expect(body['offset']).toBeNull();
  // the surface information has to travel, or the backend cannot resolve the site name
  expect((body['structure'] as { surface: unknown }).surface).not.toBeNull();
  expect(errors).toEqual([]);
});

test('a cell offset is sent only when it is not zero', async () => {
  const adsorb = vi
    .spyOn(api.crystal, 'adsorbate')
    .mockResolvedValue(normalizeStructure({ name: 'x', charge: 0 }) as never);
  section();
  await waitFor(() => expect(screen.getByLabelText('Site')).toHaveValue('bridge'));
  const first = screen.getByLabelText('Offset along the first surface vector');
  await userEvent.clear(first);
  await userEvent.type(first, '1');
  await userEvent.click(screen.getByRole('button', { name: 'Add adsorbate' }));
  await waitFor(() => expect(adsorb).toHaveBeenCalled());
  expect((adsorb.mock.calls[0]![0] as Record<string, unknown>)['offset']).toEqual([1, 0]);
});

test('a structure of the project can be the adsorbate', async () => {
  useProjectStore.setState({
    info: { path: '/p', name: 'p' } as never,
    structures: [{ id: 'w1', name: 'water' } as never],
    refresh: async () => undefined,
  });
  const water = normalizeStructure({ name: 'water', charge: 0, atoms: [makeAtom('O', [0, 0, 0])] });
  vi.spyOn(api.structures, 'get').mockResolvedValue(water as never);
  const adsorb = vi
    .spyOn(api.crystal, 'adsorbate')
    .mockResolvedValue(normalizeStructure({ name: 'x', charge: 0 }) as never);
  section();
  await waitFor(() => expect(screen.getByLabelText('Site')).toHaveValue('bridge'));
  await userEvent.selectOptions(screen.getByLabelText('or from the project'), 'w1');
  // the free-text name is then out of the way rather than silently ignored
  expect(screen.getByLabelText('Adsorbate')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Add adsorbate' }));
  await waitFor(() => expect(adsorb).toHaveBeenCalled());
  const sent = (adsorb.mock.calls[0]![0] as Record<string, unknown>)['adsorbate'];
  expect((sent as { name: string }).name).toBe('water');
});

test('a bad height is refused before anything is posted', async () => {
  const adsorb = vi.spyOn(api.crystal, 'adsorbate');
  section();
  await waitFor(() => expect(screen.getByLabelText('Site')).toHaveValue('bridge'));
  await userEvent.clear(screen.getByLabelText('Height (Å)'));
  await userEvent.type(screen.getByLabelText('Height (Å)'), '0');
  await userEvent.click(screen.getByRole('button', { name: 'Add adsorbate' }));
  expect(await screen.findByText('the height must be positive')).toBeVisible();
  expect(adsorb).not.toHaveBeenCalled();
});
