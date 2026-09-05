import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Renderer } from '../renderer/Renderer';
import { useRendererStore } from '../state/rendererStore';
import { ExportImageDialog } from './ExportImageDialog';
import { imageFileName } from './download';

const exportImage = vi.fn(() => 'data:image/png;base64,AA');
const renderer = {
  viewportSize: { width: 400, height: 300 },
  exportImage,
} as unknown as Renderer;

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  exportImage.mockClear();
  useRendererStore.getState().setRenderer(renderer);
});

test('the resolutions are multiples of the viewport, and the export uses the chosen one', () => {
  const onClose = vi.fn();
  render(<ExportImageDialog open onClose={onClose} onError={(m) => void errors.push(m)} />);
  expect(screen.getByRole('option', { name: '2× (800 × 600)' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: '4' } });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(exportImage).toHaveBeenCalledWith(
    expect.objectContaining({ width: 1600, height: 1200, type: 'image/png' }),
  );
  expect(click).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  click.mockRestore();
});

test('JPEG cannot be transparent, and says so', () => {
  render(<ExportImageDialog open onClose={() => {}} onError={(m) => void errors.push(m)} />);
  fireEvent.click(screen.getByLabelText('Transparent background'));
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'image/jpeg' } });

  expect(screen.getByLabelText('Transparent background')).toBeDisabled();
  expect(screen.getByText('JPEG has no transparency.')).toBeInTheDocument();

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(exportImage).toHaveBeenCalledWith(expect.objectContaining({ transparent: false }));
});

test('without a viewport the export says so instead of throwing', () => {
  useRendererStore.getState().setRenderer(null);
  render(<ExportImageDialog open onClose={() => {}} onError={(m) => void errors.push(m)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(errors).toEqual(['The viewport is not ready yet']);
});

test('the file name comes from the document, with the separators taken out', () => {
  expect(imageFileName('water dimer', 'image/png')).toBe('water_dimer.png');
  expect(imageFileName('a/b', 'image/jpeg')).toBe('a_b.jpg');
  expect(imageFileName('   ', 'image/png')).toBe('atomscope.png');
});
