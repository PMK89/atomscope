import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('./Viewport', () => ({
  Viewport: () => <div data-testid="viewport" />,
}));

import { App } from './App';

test('renders the shell with a viewport', () => {
  render(<App />);
  expect(screen.getByTestId('viewport')).toBeInTheDocument();
});
