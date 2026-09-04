import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the shell with a viewport', () => {
  render(<App />);
  expect(screen.getByTestId('viewport')).toBeInTheDocument();
});
