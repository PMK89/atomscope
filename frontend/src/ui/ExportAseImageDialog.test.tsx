/**
 * The ASE render dialog: which of ASE's parameters it sends, and which it hides for a format that
 * has no use for them.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportAseImageDialog } from './ExportAseImageDialog';

const exportImage = vi.fn(() =>
  Promise.resolve({ files: ['/tmp/water.png'], rendered: true, note: null }),
);

vi.mock('../api/client', () => ({
  api: { io: { exportImage: (...a: unknown[]) => exportImage(...(a as [])) } },
}));

vi.mock('../state/structureStore', () => ({
  useStructureStore: (sel: (s: unknown) => unknown) =>
    sel({
      doc: {
        id: 's1',
        name: 'water',
        atoms: [
          { element: 'O', position: [0, 0, 0] },
          { element: 'H', position: [0.96, 0, 0] },
        ],
        bonds: [{ a: 0, b: 1, order: 1 }],
      },
    }),
}));

describe('ExportAseImageDialog', () => {
  beforeEach(() => exportImage.mockClear());

  it('is not in the document until opened', () => {
    const { container } = render(
      <ExportAseImageDialog open={false} onClose={() => {}} onError={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("sends ASE's parameters, with the viewport's own bonds", async () => {
    render(<ExportAseImageDialog open onClose={() => {}} onError={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Render' }));
    await waitFor(() => expect(exportImage).toHaveBeenCalledTimes(1));
    const body = exportImage.mock.calls[0]![0] as unknown as {
      format: string;
      options: Record<string, unknown>;
    };
    expect(body.format).toBe('png');
    // 'auto' is asecppaw's simplePOV rule, resolved on the server where the positions are
    expect(body.options['rotation']).toBe('auto');
    expect(body.options['scale']).toBe(20);
    expect(body.options['show_unit_cell']).toBe(2);
    // the bonds come from the document, so the render matches what is on screen
    expect(body.options['bondatoms']).toEqual([[0, 1]]);
  });

  it('sends no bonds when they are switched off', async () => {
    render(<ExportAseImageDialog open onClose={() => {}} onError={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Draw the bonds/));
    fireEvent.click(screen.getByRole('button', { name: 'Render' }));
    await waitFor(() => expect(exportImage).toHaveBeenCalled());
    const body = exportImage.mock.calls[0]![0] as unknown as { options: Record<string, unknown> };
    expect(body.options['bondatoms']).toEqual([]);
  });

  it('offers the POV-Ray parameters only for POV-Ray', () => {
    render(<ExportAseImageDialog open onClose={() => {}} onError={() => {}} />);
    expect(screen.queryByLabelText('camera distance')).toBeNull();
    fireEvent.change(screen.getByLabelText('format'), { target: { value: 'pov' } });
    expect(screen.getByLabelText('camera distance')).not.toBeNull();
    expect(screen.getByLabelText('canvas width')).not.toBeNull();
    // scale is meaningless for pov -- write_pov supplies its own -- so it is not offered
    expect(screen.queryByLabelText(/scale/)).toBeNull();
  });

  it('hides the projection parameters for a scene description', () => {
    render(<ExportAseImageDialog open onClose={() => {}} onError={() => {}} />);
    fireEvent.change(screen.getByLabelText('format'), { target: { value: 'x3d' } });
    expect(screen.queryByLabelText('rotation')).toBeNull();
    expect(screen.queryByLabelText('unit cell')).toBeNull();
  });

  it('reports what was written, and why it was not rendered', async () => {
    exportImage.mockImplementationOnce(() =>
      Promise.resolve({
        files: ['/tmp/w.pov', '/tmp/w.ini'],
        rendered: false,
        note: 'POV-Ray is not installed here',
      }),
    );
    render(<ExportAseImageDialog open onClose={() => {}} onError={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Render' }));
    await waitFor(() => expect(screen.getByText(/w\.pov/)).not.toBeNull());
    expect(screen.getByText(/not installed/)).not.toBeNull();
  });
});
