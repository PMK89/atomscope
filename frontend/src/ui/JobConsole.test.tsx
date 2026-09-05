import { render, screen } from '@testing-library/react';
import { useCalculationStore } from '../state/calculationStore';
import { JobConsole } from './JobConsole';

function seed(): void {
  useCalculationStore.setState({
    calculations: [
      {
        id: 'c1',
        name: 'run',
        backend_id: 'cppaw',
        structure_id: 's1',
        status: 'completed',
        job: { id: 'job-main', spec: { argv: ['x'], cwd: '/tmp' }, status: 'completed' },
        analysis_jobs: [
          {
            kind: 'dos',
            job: { id: 'job-dos', spec: { argv: ['x'], cwd: '/tmp' }, status: 'completed' },
          },
        ],
      } as never,
    ],
    selectedId: 'c1',
    logs: {
      'job-main': [{ stream: 'stdout', line: 'main line' }],
      'job-dos': [{ stream: 'dos.log', line: 'dos line' }],
    },
  });
}

test('shows main job output first, then analysis jobs, without re-render loops', () => {
  seed();
  // A selector returning a freshly built array made useSyncExternalStore loop forever and
  // crashed the app; rendering must simply succeed and keep job order.
  render(<JobConsole />);
  const lines = screen.getAllByText(/line$/).map((n) => n.textContent?.trim());
  expect(lines).toEqual(['stdout main line', 'dos.log dos line']);
});

test('prompts when nothing is selected', () => {
  useCalculationStore.setState({ calculations: [], selectedId: null, logs: {} });
  render(<JobConsole />);
  expect(screen.getByText(/Select or run a calculation/)).toBeInTheDocument();
});
