import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { emptyStructure, makeAtom } from '../model/structure';
import { useStructureStore } from '../state/structureStore';
import { useTrajectoryStore } from '../state/trajectoryStore';
import { TrajectoryPlayer } from './TrajectoryPlayer';

const initial = useTrajectoryStore.getState();

beforeEach(() => {
  useTrajectoryStore.setState(initial, true);
  useStructureStore.getState().load({
    ...emptyStructure('h2'),
    atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [0.7, 0, 0])],
  });
});

function loadDemo(): void {
  useTrajectoryStore.getState().loadFromResult({
    trajectory: {
      id: 't',
      name: 'demo',
      kind: 'md',
      symbols: ['H', 'H'],
      frames: [0, 1, 2].map((i) => ({
        positions: [
          [0, 0, 0],
          [0.7 + 0.1 * i, 0, 0],
        ],
        energy: -1 - i,
        time: 1500 * i,
        temperature: 300,
      })),
    },
  });
}

test('renders nothing without a trajectory', () => {
  const { container } = render(<TrajectoryPlayer onError={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('steps, plays on a timer and shows the readout', () => {
  vi.useFakeTimers();
  loadDemo();
  render(<TrajectoryPlayer onError={() => {}} />);
  expect(screen.getByText('frame 1/3')).toBeInTheDocument();
  expect(screen.getByText('E = -1.0000 eV')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('next frame'));
  expect(screen.getByText('frame 2/3')).toBeInTheDocument();
  expect(screen.getByText('t = 1.500 ps')).toBeInTheDocument();
  expect(screen.getByText('T = 300.0 K')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('play'));
  act(() => {
    vi.advanceTimersByTime(1000 / 15 + 5);
  });
  expect(screen.getByText('frame 3/3')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(1000 / 15 + 5);
  });
  expect(screen.getByText('frame 1/3')).toBeInTheDocument(); // loop mode wraps
  fireEvent.click(screen.getByLabelText('pause'));
  expect(useTrajectoryStore.getState().playing).toBe(false);
  expect(screen.getByRole('img', { name: 'energy per frame' })).toBeInTheDocument();
  vi.useRealTimers();
});

test('load frame as structure commits an undoable change', () => {
  loadDemo();
  render(<TrajectoryPlayer onError={() => {}} />);
  fireEvent.click(screen.getByLabelText('last frame'));
  fireEvent.click(screen.getByText('Load frame as structure'));
  const st = useStructureStore.getState();
  expect(st.doc.atoms[1]!.position[0]).toBeCloseTo(0.9);
  expect(st.undoLabel()).toBe('load trajectory frame 2');
  fireEvent.click(screen.getByLabelText('close trajectory'));
  expect(useTrajectoryStore.getState().trajectory).toBeNull();
});
