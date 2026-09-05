import { beforeEach } from 'vitest';
import {
  advanceFrame,
  frameCell,
  framePositions,
  frameToStructure,
  isTrajectoryCompatible,
  trajectoryFromScalars,
  trajectoryToJson,
  type ApiTrajectory,
} from '../model/trajectory';
import { emptyStructure, makeAtom } from '../model/structure';
import { useStructureStore } from './structureStore';
import { useTrajectoryStore } from './trajectoryStore';

/** Shape of `calc.results` as the CalculationPanel sees it. */
const resultBundle: { trajectory: ApiTrajectory } = {
  trajectory: {
    id: 't1',
    name: 'md',
    kind: 'md',
    symbols: ['H', 'H'],
    frames: [0, 1, 2, 3].map((i) => ({
      positions: [
        [0, 0, 0],
        [0.7 + 0.1 * i, 0, 0],
      ],
      cell:
        i === 0
          ? null
          : [
              [10, 0, 0],
              [0, 10, 0],
              [0, 0, 10],
            ],
      energy: i === 2 ? null : -1 - i,
      time: 0.5 * i,
      step: i,
    })),
  },
};

const initial = useTrajectoryStore.getState();

beforeEach(() => {
  useTrajectoryStore.setState(initial, true);
});

test('loads from a ResultBundle-like object into typed arrays', () => {
  useTrajectoryStore.getState().loadFromResult(resultBundle);
  const t = useTrajectoryStore.getState().trajectory!;
  expect(t.nFrames).toBe(4);
  expect(t.nAtoms).toBe(2);
  expect(t.positions).toBeInstanceOf(Float32Array);
  expect(t.positions.length).toBe(4 * 2 * 3);
  expect(framePositions(t, 3)[3]).toBeCloseTo(1.0);
  expect(t.energy[0]).toBe(-1);
  expect(Number.isNaN(t.energy[2]!)).toBe(true);
  expect(Number.isNaN(t.temperature[0]!)).toBe(true);
  expect(frameCell(t, 0)).toBeNull();
  expect(frameCell(t, 1)![0]).toEqual([10, 0, 0]);
  expect(useTrajectoryStore.getState().frame).toBe(0);
  // round trip back to JSON keeps positions and scalars
  const json = trajectoryToJson(t);
  expect(json.frames![3]!.positions[1]![0]).toBeCloseTo(1.0);
  expect(json.frames![2]!.energy).toBeNull();
  expect(json.frames![1]!.step).toBe(1);
});

test('loads scalars plus a binary positions buffer and validates the length', () => {
  const scalars = {
    id: 't',
    name: 'n',
    kind: 'generic',
    n_frames: 2,
    n_atoms: 1,
    symbols: ['He'],
    energy: [1, null],
    time: [null, null],
    temperature: [null, null],
    step: [0, 1],
    cells: [null, null],
  };
  const t = trajectoryFromScalars(scalars, new Float32Array([0, 0, 0, 1, 2, 3]));
  expect(Array.from(framePositions(t, 1))).toEqual([1, 2, 3]);
  expect(t.cells).toBeNull();
  expect(() => trajectoryFromScalars(scalars, new Float32Array(5))).toThrow(/does not match/);
});

test('frame navigation clamps and stepping pauses playback', () => {
  const st = useTrajectoryStore.getState();
  st.loadFromResult(resultBundle);
  st.setFrame(10);
  expect(useTrajectoryStore.getState().frame).toBe(3);
  st.setFrame(-4);
  expect(useTrajectoryStore.getState().frame).toBe(0);
  st.play();
  expect(useTrajectoryStore.getState().playing).toBe(true);
  st.step(2);
  expect(useTrajectoryStore.getState().frame).toBe(2);
  expect(useTrajectoryStore.getState().playing).toBe(false);
  st.setFps(500);
  expect(useTrajectoryStore.getState().fps).toBe(120);
});

test('tick advances, loops and ping-pongs', () => {
  const st = useTrajectoryStore.getState();
  st.loadFromResult(resultBundle);
  st.setLoop('loop');
  st.setFrame(3);
  st.play();
  st.tick();
  expect(useTrajectoryStore.getState().frame).toBe(0);
  expect(useTrajectoryStore.getState().playing).toBe(true);

  st.setLoop('pingpong');
  st.setFrame(2);
  st.tick();
  expect(useTrajectoryStore.getState().frame).toBe(3);
  st.tick();
  expect(useTrajectoryStore.getState()).toMatchObject({ frame: 2, direction: -1, playing: true });
  st.tick();
  st.tick();
  expect(useTrajectoryStore.getState()).toMatchObject({ frame: 0, direction: -1 });
  st.tick();
  expect(useTrajectoryStore.getState()).toMatchObject({ frame: 1, direction: 1 });

  st.setLoop('once');
  st.setFrame(3);
  st.play(); // at the end with 'once': restarts from 0
  expect(useTrajectoryStore.getState().frame).toBe(0);
  st.setFrame(3);
  st.tick();
  expect(useTrajectoryStore.getState()).toMatchObject({ frame: 3, playing: false });
  st.tick(); // not playing: no-op
  expect(useTrajectoryStore.getState().frame).toBe(3);
});

test('advanceFrame handles single-frame trajectories', () => {
  expect(advanceFrame(0, 1, 1, 'loop')).toEqual({ frame: 0, direction: 1, playing: false });
  expect(advanceFrame(0, 1, 0, 'pingpong').playing).toBe(false);
});

test('compatibility needs the atom count, the ordered symbols and the source structure', () => {
  useTrajectoryStore.getState().loadFromResult(resultBundle);
  const t = useTrajectoryStore.getState().trajectory!;
  const h2 = {
    ...emptyStructure('h2'),
    atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [1, 0, 0])],
  };
  expect(isTrajectoryCompatible(h2, t)).toBe(true);
  // same atom count, different elements
  const hd = { ...h2, atoms: [makeAtom('H', [0, 0, 0]), makeAtom('C', [1, 0, 0])] };
  expect(isTrajectoryCompatible(hd, t)).toBe(false);
  // same elements, wrong order
  const ch = { ...h2, atoms: [makeAtom('C', [0, 0, 0]), makeAtom('H', [1, 0, 0])] };
  expect(isTrajectoryCompatible(ch, t)).toBe(false);
  expect(isTrajectoryCompatible(emptyStructure(), t)).toBe(false);
  // a trajectory naming its source structure only fits that structure
  expect(isTrajectoryCompatible(h2, { ...t, structureId: 'other' })).toBe(false);
  expect(isTrajectoryCompatible(h2, { ...t, structureId: h2.id })).toBe(true);
});

test('loading an incompatible structure clears the trajectory', () => {
  useTrajectoryStore.getState().loadFromResult(resultBundle);
  const h2 = {
    ...emptyStructure('h2'),
    atoms: [makeAtom('H', [0, 0, 0]), makeAtom('H', [1, 0, 0])],
  };
  useStructureStore.getState().load(h2);
  expect(useTrajectoryStore.getState().trajectory).not.toBeNull();
  useStructureStore.getState().load({
    ...emptyStructure('methane'),
    atoms: [makeAtom('C', [0, 0, 0]), makeAtom('H', [1, 0, 0])],
  });
  expect(useTrajectoryStore.getState().trajectory).toBeNull();
});

test('a frame can be committed to a structure document', () => {
  useTrajectoryStore.getState().loadFromResult(resultBundle);
  const t = useTrajectoryStore.getState().trajectory!;
  const doc = {
    ...emptyStructure('h2'),
    atoms: [makeAtom('H', [9, 9, 9]), makeAtom('H', [9, 9, 9])],
  };
  const next = frameToStructure(doc, t, 3)!;
  expect(next.atoms[1]!.position[0]).toBeCloseTo(1.0);
  expect(next.atoms[1]!.uid).toBe(doc.atoms[1]!.uid);
  expect(next.cell?.vectors[2]).toEqual([0, 0, 10]);
  expect(frameToStructure(emptyStructure(), t, 0)).toBeNull();
  expect(frameToStructure(doc, t, 7)).toBeNull();
});
