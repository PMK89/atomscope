import { Vector3 } from 'three';
import { formula, makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import type { PickResult } from '../renderer/Renderer';
import type { PointerLike, ToolCamera, ToolRenderer } from './Tool';
import { ToolHost } from './ToolHost';
import { useToolStore } from './toolStore';
import { api } from '../api/client';
import { undoEdit } from '../ui/historyActions';
import { AutoOptimizeTool } from './tools/AutoOptimizeTool';
import { AutoRotateTool } from './tools/AutoRotateTool';
import { createTools } from './tools';

/** Orthographic fake: 100 px per Å, origin at (400, 300), looking down -z. */
class FakeCamera implements ToolCamera {
  pivot = new Vector3();
  enabled = true;
  rotations: [number, number][] = [];
  rolls: number[] = [];
  setPivot(c: Vector3): void {
    this.pivot.copy(c);
  }
  rotateBy(a: number, p: number): void {
    this.rotations.push([a, p]);
  }
  roll(a: number): void {
    this.rolls.push(a);
  }
  resetRoll(): void {
    this.rolls.push(0);
  }
  viewDirection(out: Vector3): Vector3 {
    return out.set(0, 0, -1);
  }
  worldPerPixel(): number {
    return 0.01;
  }
  axes() {
    return {
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 1, 0),
      forward: new Vector3(0, 0, -1),
    };
  }
}

class FakeRenderer implements ToolRenderer {
  controller = new FakeCamera();
  fitted = 0;
  picks = 0;
  pick(cx: number, cy: number): PickResult | null {
    this.picks++;
    const doc = useStructureStore.getState().doc;
    for (let i = 0; i < doc.atoms.length; i++) {
      const p = this.project(new Vector3(...doc.atoms[i]!.position));
      if (Math.hypot(p.x - cx, p.y - cy) < 12) return { kind: 'atom', index: i };
    }
    for (let i = 0; i < doc.bonds.length; i++) {
      const b = doc.bonds[i]!;
      const a = doc.atoms[b.a]!.position;
      const c = doc.atoms[b.b]!.position;
      const p = this.project(new Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2));
      if (Math.hypot(p.x - cx, p.y - cy) < 6) return { kind: 'bond', index: i };
    }
    return null;
  }
  project(w: Vector3) {
    return { x: 400 + 100 * w.x, y: 300 - 100 * w.y };
  }
  toCanvasCoords(x: number, y: number) {
    return { x, y };
  }
  unprojectOnPlane(cx: number, cy: number, plane: Vector3): Vector3 {
    return new Vector3((cx - 400) / 100, (300 - cy) / 100, plane.z);
  }
  unprojectOnPivotPlane(cx: number, cy: number): Vector3 {
    return this.unprojectOnPlane(cx, cy, this.controller.pivot);
  }
  fitToStructure(): void {
    this.fitted++;
  }
  invalidate(): void {}
}

const ev = (x: number, y: number, o: Partial<PointerLike> = {}): PointerLike => ({
  clientX: x,
  clientY: y,
  button: 0,
  buttons: 0,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...o,
});

/** Screen position of a world point in the fake camera. */
const at = (x: number, y: number) => [400 + 100 * x, 300 - 100 * y] as const;

function click(host: ToolHost, x: number, y: number, o: Partial<PointerLike> = {}): void {
  host.pointerDown(ev(x, y, { ...o, buttons: o.button === 2 ? 2 : 1 }));
  host.pointerUp(ev(x, y, o));
}

function drag(
  host: ToolHost,
  from: readonly [number, number],
  to: readonly [number, number],
  button = 0,
  o: Partial<PointerLike> = {},
): void {
  const buttons = button === 2 ? 2 : 1;
  host.pointerDown(ev(from[0], from[1], { ...o, button, buttons }));
  host.pointerMove(ev((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { ...o, button, buttons }));
  host.pointerMove(ev(to[0], to[1], { ...o, button, buttons }));
  host.pointerUp(ev(to[0], to[1], { ...o, button }));
}

// ethane-like skeleton without hydrogens: C0 at origin, C1 at x=1.5, and a lone O far away
function loadSkeleton(): void {
  useStructureStore.getState().load(
    normalizeStructure({
      name: 'skel',
      charge: 0,
      atoms: [makeAtom('C', [0, 0, 0]), makeAtom('C', [1.5, 0, 0]), makeAtom('O', [-2, 2, 0])],
      bonds: [makeBond(0, 1)],
    }),
  );
  useSelectionStore.getState().clear();
  useToolStore.setState({
    active: 'navigate',
    draw: { element: 'C', bondOrder: 1, adjustHydrogens: false },
    select: { mode: 'atoms', rect: null },
    bondCentric: { bond: null },
    measure: { atoms: [] },
    autoRotate: { running: false, x: 0, y: 20, z: 0 },
  });
}

/** Hover picking is throttled to animation frames; tests run them by hand. */
let frames: (() => void)[] = [];
const flushFrames = (): void => {
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

let renderer: FakeRenderer;
let host: ToolHost;
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  loadSkeleton();
  renderer = new FakeRenderer();
  host = new ToolHost(renderer, createTools());
});
afterEach(() => {
  host.dispose();
  vi.unstubAllGlobals();
});

const S = () => useStructureStore.getState();
const sel = () => [...useSelectionStore.getState().atoms].sort();

describe('host', () => {
  test('shortcuts switch tools and gate the camera controller', () => {
    expect(renderer.controller.enabled).toBe(true);
    expect(
      host.keyDown({ key: 'd', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }),
    ).toBe(true);
    expect(useToolStore.getState().active).toBe('draw');
    expect(host.activeTool.id).toBe('draw');
    expect(renderer.controller.enabled).toBe(false);
    expect(
      host.keyDown({ key: 'z', shiftKey: false, ctrlKey: true, altKey: false, metaKey: false }),
    ).toBe(false);
  });
  test('hover updates the selection store for every tool, once per frame', () => {
    host.pointerMove(ev(...at(1.5, 0)));
    // the pick waits for the next animation frame
    expect(useSelectionStore.getState().hoveredAtom).toBeNull();
    flushFrames();
    expect(useSelectionStore.getState().hoveredAtom).toBe(1);
    host.pointerMove(ev(10, 10));
    flushFrames();
    expect(useSelectionStore.getState().hoveredAtom).toBeNull();
  });
  test('hover picks at most once per frame and ignores sub-pixel movement', () => {
    const picks = () => renderer.picks;
    host.pointerMove(ev(...at(1.5, 0)));
    host.pointerMove(ev(300, 300));
    host.pointerMove(ev(...at(0, 0)));
    expect(picks()).toBe(0);
    flushFrames();
    // only the newest position was picked
    expect(picks()).toBe(1);
    expect(useSelectionStore.getState().hoveredAtom).toBe(0);
    // a move of one pixel is not worth another raycast
    const [x, y] = at(0, 0);
    host.pointerMove(ev(x + 1, y));
    flushFrames();
    expect(picks()).toBe(1);
    host.pointerMove(ev(x + 40, y));
    flushFrames();
    expect(picks()).toBe(2);
    // a document change invalidates the last pick, so even a small move looks again
    S().commit('move', { ...S().doc, name: 'moved' });
    host.pointerMove(ev(x + 41, y));
    flushFrames();
    expect(picks()).toBe(3);
  });
  test('switching tools mid-drag cancels the preview', () => {
    useToolStore.getState().setActive('manipulate');
    host.pointerDown(ev(...at(1.5, 0), { buttons: 1 }));
    host.pointerMove(ev(...at(1.5, 1), { buttons: 1 }));
    expect(S().previewBase).not.toBeNull();
    host.keyDown({ key: 's', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(S().previewBase).toBeNull();
    expect(S().doc.atoms[1]!.position[1]).toBe(0);
    expect(S().canUndo()).toBe(false);
  });
  test('undo mid-drag aborts the gesture instead of committing a stale base', () => {
    S().commit('move', { ...S().doc, name: 'moved' });
    useToolStore.getState().setActive('manipulate');
    host.pointerDown(ev(...at(1.5, 0), { buttons: 1 }));
    host.pointerMove(ev(...at(1.5, 1), { buttons: 1 }));
    expect(S().previewBase).not.toBeNull();
    S().undo();
    // further events of the aborted drag are ignored
    host.pointerMove(ev(...at(1.5, 2), { buttons: 1 }));
    host.pointerUp(ev(...at(1.5, 2)));
    expect(S().doc.name).toBe('skel');
    expect(S().doc.atoms[1]!.position[1]).toBe(0);
    expect(S().previewBase).toBeNull();
    expect(S().undoStack).toHaveLength(0);
    expect(S().canRedo()).toBe(true);
    // the next gesture starts from the undone document
    drag(host, at(1.5, 0), at(1.5, 1));
    expect(S().doc.atoms[1]!.position[1]).toBeCloseTo(1);
    expect(S().undoLabel()).toBe('Move 1 atom');
  });
  test('loading another document clears measurement picks', () => {
    useToolStore.getState().update('measure', { atoms: [0, 1] });
    useStructureStore.getState().load(normalizeStructure({ name: 'x', charge: 0 }));
    expect(useToolStore.getState().measure.atoms).toEqual([]);
  });
});

describe('navigate', () => {
  test('double-click re-centers on an atom, or fits when empty', () => {
    host.doubleClick(ev(...at(1.5, 0)));
    expect(renderer.controller.pivot.x).toBeCloseTo(1.5);
    host.doubleClick(ev(5, 5));
    expect(renderer.fitted).toBe(1);
  });
});

describe('select', () => {
  beforeEach(() => useToolStore.getState().setActive('select'));
  test('click, shift-add, ctrl-toggle, click empty clears', () => {
    click(host, ...at(0, 0));
    expect(sel()).toEqual([0]);
    click(host, ...at(1.5, 0), { shiftKey: true });
    expect(sel()).toEqual([0, 1]);
    click(host, ...at(0, 0), { ctrlKey: true });
    expect(sel()).toEqual([1]);
    click(host, 20, 20);
    expect(sel()).toEqual([]);
  });
  test('rubber band selects enclosed atoms and clears the rect', () => {
    drag(host, [350, 350], [600, 250]);
    expect(sel()).toEqual([0, 1]);
    expect(useToolStore.getState().select.rect).toBeNull();
  });
  test('molecule mode and double-click select fragments', () => {
    useToolStore.getState().update('select', { mode: 'molecules' });
    click(host, ...at(0, 0));
    expect(sel()).toEqual([0, 1]);
    useToolStore.getState().update('select', { mode: 'atoms' });
    click(host, ...at(-2, 2));
    expect(sel()).toEqual([2]);
    host.doubleClick(ev(...at(1.5, 0)));
    expect(sel()).toEqual([0, 1]);
  });
});

describe('draw', () => {
  beforeEach(() => useToolStore.getState().setActive('draw'));
  test('click in empty space adds an atom of the current element at the pivot plane', () => {
    useToolStore.getState().update('draw', { element: 'N' });
    click(host, ...at(3, -1));
    const doc = S().doc;
    expect(doc.atoms).toHaveLength(4);
    expect(doc.atoms[3]!.element).toBe('N');
    expect(doc.atoms[3]!.position).toEqual([3, -1, 0]);
    expect(S().undoLabel()).toBe('Add N');
    S().undo();
    expect(S().doc.atoms).toHaveLength(3);
  });
  test('click on an atom changes its element; adjust hydrogens saturates it', () => {
    useToolStore.getState().update('draw', { element: 'O', adjustHydrogens: true });
    click(host, ...at(-2, 2)); // same element: no-op
    expect(S().canUndo()).toBe(false);
    click(host, ...at(1.5, 0));
    expect(S().doc.atoms[1]!.element).toBe('O');
    expect(S().doc.atoms.filter((a) => a.element === 'H')).toHaveLength(1);
    expect(S().undoLabel()).toBe('Change to O');
  });
  test('adding a carbon next to methane yields ethane, not an over-coordinated carbon', () => {
    // methane with one C-H bond along -x, so a new carbon at +1.53 Å only reaches the carbon
    useStructureStore.getState().load(
      normalizeStructure({
        name: 'methane',
        charge: 0,
        atoms: [
          makeAtom('C', [0, 0, 0]),
          makeAtom('H', [-1.09, 0, 0]),
          makeAtom('H', [0.3633, 1.0277, 0]),
          makeAtom('H', [0.3633, -0.5138, 0.89]),
          makeAtom('H', [0.3633, -0.5138, -0.89]),
        ],
        bonds: [makeBond(0, 1), makeBond(0, 2), makeBond(0, 3), makeBond(0, 4)],
      }),
    );
    useToolStore.getState().update('draw', { element: 'C', adjustHydrogens: true });
    click(host, ...at(1.53, 0));
    const doc = S().doc;
    expect(formula(doc)).toBe('C2H6');
    // the pre-existing carbon lost one hydrogen when it gained the C-C bond
    expect(doc.bonds.filter((b) => b.a === 0 || b.b === 0)).toHaveLength(4);
    S().undo();
    expect(formula(S().doc)).toBe('CH4');
  });
  test('click on a bond cycles its order', () => {
    click(host, ...at(0.75, 0));
    expect(S().doc.bonds[0]!.order).toBe(2);
    expect(S().undoLabel()).toBe('Change bond order');
  });
  test('drag from an atom grows a bonded atom at the covalent distance', () => {
    drag(host, at(0, 0), at(0, -2));
    const doc = S().doc;
    expect(doc.atoms).toHaveLength(4);
    expect(doc.bonds).toHaveLength(2);
    const p = doc.atoms[3]!.position;
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(-1.52); // 2 * r_cov(C)
    expect(S().undoLabel()).toBe('Add C');
    expect(S().previewBase).toBeNull();
    S().undo();
    expect(S().doc.atoms).toHaveLength(3);
  });
  test('drag from atom to atom creates a bond with the chosen order', () => {
    useToolStore.getState().update('draw', { bondOrder: 2 });
    drag(host, at(0, 0), at(-2, 2));
    expect(S().doc.bonds).toHaveLength(2);
    expect(S().doc.bonds[1]).toMatchObject({ a: 0, b: 2, order: 2 });
    expect(S().undoLabel()).toBe('Add bond');
  });
  test('right-click deletes an atom (with its hydrogens) or a bond and remaps the selection', () => {
    useToolStore.getState().update('draw', { adjustHydrogens: true, element: 'O' });
    click(host, ...at(1.5, 0)); // C1 -> O with one H appended (index 3)
    expect(S().doc.atoms).toHaveLength(4);
    useSelectionStore.getState().set([2]);
    click(host, ...at(1.5, 0), { button: 2 });
    // O1 and its H are gone; the neighbouring carbon is re-saturated
    expect(S().doc.atoms.map((a) => a.element)).toEqual(['C', 'O', 'H', 'H', 'H', 'H']);
    expect(sel()).toEqual([1]);
    expect(S().undoLabel()).toBe('Delete 2 atoms');
    useToolStore.getState().update('draw', { adjustHydrogens: false });
    loadSkeleton();
    useToolStore.getState().setActive('draw');
    click(host, ...at(0.75, 0), { button: 2 });
    expect(S().doc.bonds).toHaveLength(0);
    expect(S().undoLabel()).toBe('Delete bond');
  });
  test('keys 1/2/3 set the bond order', () => {
    host.keyDown({ key: '3', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(useToolStore.getState().draw.bondOrder).toBe(3);
  });
});

describe('manipulate', () => {
  beforeEach(() => useToolStore.getState().setActive('manipulate'));
  test('drag moves the atom under the cursor in the view plane and commits once', () => {
    drag(host, at(1.5, 0), at(1.5, 1));
    expect(S().doc.atoms[1]!.position[1]).toBeCloseTo(1);
    expect(S().undoLabel()).toBe('Move 1 atom');
    expect(S().undoStack).toHaveLength(1);
    S().undo();
    expect(S().doc.atoms[1]!.position[1]).toBe(0);
  });
  test('drag moves the whole selection; shift moves along the view axis', () => {
    useSelectionStore.getState().set([0, 1]);
    drag(host, [100, 100], [200, 100]);
    expect(S().doc.atoms[0]!.position[0]).toBeCloseTo(1);
    expect(S().doc.atoms[1]!.position[0]).toBeCloseTo(2.5);
    expect(S().doc.atoms[2]!.position[0]).toBe(-2);
    expect(S().undoLabel()).toBe('Move 2 atoms');
    drag(host, [100, 100], [100, 200], 0, { shiftKey: true });
    expect(S().doc.atoms[0]!.position[2]).toBeCloseTo(1);
  });
  test('right-drag rotates the selection about its centroid', () => {
    useSelectionStore.getState().set([0, 1]);
    drag(host, [100, 100], [100 + Math.PI / 0.01, 100], 2);
    expect(S().doc.atoms[0]!.position[0]).toBeCloseTo(1.5);
    expect(S().doc.atoms[1]!.position[0]).toBeCloseTo(0);
    expect(S().undoLabel()).toBe('Rotate 2 atoms');
  });
  test('a click without movement leaves no history', () => {
    click(host, ...at(0, 0));
    expect(S().canUndo()).toBe(false);
  });
});

describe('bond-centric', () => {
  beforeEach(() => useToolStore.getState().setActive('bond-centric'));
  test('click selects a bond, drag along it changes the length by moving the smaller side', () => {
    click(host, ...at(0.75, 0));
    expect(useToolStore.getState().bondCentric.bond).toBe(0);
    // sides are equal (one atom each): atom b moves; dragging +x by 50 px lengthens by 0.5 Å
    drag(host, [500, 500], [550, 500]);
    expect(S().doc.atoms[1]!.position[0]).toBeCloseTo(2.0);
    expect(S().doc.atoms[0]!.position[0]).toBe(0);
    expect(S().undoLabel()).toBe('Change bond length');
  });
  test('click in empty space deselects the bond', () => {
    click(host, ...at(0.75, 0));
    click(host, 10, 10);
    expect(useToolStore.getState().bondCentric.bond).toBeNull();
  });
});

describe('measure', () => {
  beforeEach(() => useToolStore.getState().setActive('measure'));
  test('collects up to four picks, toggles, resets on right-click', () => {
    click(host, ...at(0, 0));
    click(host, ...at(1.5, 0));
    expect(useToolStore.getState().measure.atoms).toEqual([0, 1]);
    const shapes = host.activeTool.overlay!(host.ctx);
    const label = shapes.find((s) => s.kind === 'label');
    expect(label).toMatchObject({ x: 400 + 75 + 6, y: 300 - 6, text: '1.500 Å' });
    click(host, ...at(0, 0));
    expect(useToolStore.getState().measure.atoms).toEqual([1]);
    click(host, ...at(0, 0), { button: 2 });
    expect(useToolStore.getState().measure.atoms).toEqual([]);
  });
});

describe('auto-rotate', () => {
  test('step rotates by speed * dt and pointer interaction stops it', () => {
    useToolStore.getState().setActive('auto-rotate');
    const tool = host.activeTool as AutoRotateTool;
    useToolStore.getState().update('autoRotate', { x: 0, y: 90, z: 45 });
    tool.step(host.ctx, 0.5);
    expect(renderer.controller.rotations[0]![0]).toBeCloseTo(Math.PI / 4);
    expect(renderer.controller.rolls[0]).toBeCloseTo(Math.PI / 8);
    useToolStore.getState().update('autoRotate', { running: true });
    host.pointerDown(ev(1, 1, { buttons: 1 }));
    expect(useToolStore.getState().autoRotate.running).toBe(false);
    expect(renderer.controller.enabled).toBe(true);
  });
});

describe('auto-optimize', () => {
  /** The backend answer: every atom pulled a tenth of the way towards the origin. */
  const shrink = () => {
    const doc = useStructureStore.getState().doc;
    return {
      structure: {
        ...doc,
        atoms: doc.atoms.map((a) => ({
          ...a,
          position: a.position.map((x) => x * 0.9) as [number, number, number],
        })),
      },
      energy: { value: -1, unit: 'eV' },
      converged: false,
    };
  };

  /** Run the tool with a hand-driven timer, so a "round" is one call to the returned function. */
  function armed(): { tool: AutoOptimizeTool; next: () => Promise<void> } {
    useToolStore.getState().setActive('auto-optimize');
    const tool = host.activeTool as AutoOptimizeTool;
    let pending: (() => void) | null = null;
    tool.useScheduler(
      (fn) => {
        pending = fn;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      () => undefined,
    );
    return {
      tool,
      // wait for the round in flight to land (it schedules the next one), then run that one
      next: async () => {
        await vi.waitFor(() => expect(pending).not.toBe(null));
        const fn = pending;
        pending = null;
        fn?.();
      },
    };
  }

  test('rounds preview and the run commits once, as a single undo step', async () => {
    const step = vi
      .spyOn(api.chem, 'optimizeStep')
      .mockImplementation(() => Promise.resolve(shrink() as never));
    const before = S().doc;
    const { next } = armed();
    useToolStore.getState().update('autoOptimize', { running: true });
    await vi.waitFor(() => expect(S().doc).not.toBe(before));
    expect(step).toHaveBeenCalledTimes(1);
    // still a preview: nothing on the undo stack yet
    expect(S().undoLabel()).toBe(null);

    await next();
    await vi.waitFor(() => expect(step).toHaveBeenCalledTimes(2));

    useToolStore.getState().update('autoOptimize', { running: false });
    expect(S().undoLabel()).toBe('Auto-optimize');
    S().undo();
    expect(S().doc.atoms[1]!.position).toEqual(before.atoms[1]!.position);
  });

  test('a dragged atom is pinned and follows the pointer through the rounds', async () => {
    const step = vi
      .spyOn(api.chem, 'optimizeStep')
      .mockImplementation(() => Promise.resolve(shrink() as never));
    const { next } = armed();
    const before = S().doc;
    useToolStore.getState().update('autoOptimize', { running: true });
    await vi.waitFor(() => expect(S().doc).not.toBe(before));

    host.pointerDown(ev(...at(0, 0), { buttons: 1 }));
    host.pointerMove(ev(...at(2, 1), { buttons: 1 }));
    expect(S().doc.atoms[0]!.position).toEqual([2, 1, 0]);

    await next();
    await vi.waitFor(() => expect(step).toHaveBeenCalledTimes(2));
    expect(step.mock.calls[1]![0]).toMatchObject({ fixed_atoms: [0] });
    // the round moved every atom, but the held one is written back where the pointer is
    expect(S().doc.atoms[0]!.position).toEqual([2, 1, 0]);
  });

  test('a round that lands mid-drag still relaxes the molecule', async () => {
    // the request is held open, so the pointer moves while the round is in flight
    let release: (() => void) | null = null;
    const step = vi.spyOn(api.chem, 'optimizeStep').mockImplementation(
      () =>
        new Promise((resolve) => {
          const answer = shrink();
          release = () => resolve(answer as never);
        }),
    );
    const { next } = armed();
    useToolStore.getState().update('autoOptimize', { running: true });
    await vi.waitFor(() => expect(step).toHaveBeenCalledTimes(1));
    release!();
    await next();

    host.pointerDown(ev(...at(0, 0), { buttons: 1 }));
    await vi.waitFor(() => expect(step).toHaveBeenCalledTimes(2));
    const held = S().doc.atoms[1]!.position;
    // the pointer moves while round 2 is still open: the tool's own preview must not look stale
    host.pointerMove(ev(...at(2, 1), { buttons: 1 }));
    release!();

    await vi.waitFor(() => expect(S().doc.atoms[1]!.position).not.toEqual(held));
    expect(S().doc.atoms[0]!.position).toEqual([2, 1, 0]);
  });

  test('dragging without a run leaves no preview behind', () => {
    armed();
    const before = S().doc;
    host.pointerDown(ev(...at(0, 0), { buttons: 1 }));
    host.pointerMove(ev(...at(2, 1), { buttons: 1 }));
    host.pointerUp(ev(...at(2, 1)));
    expect(S().doc).toBe(before);
    expect(useStructureStore.getState().previewBase).toBe(null);
  });

  test('undo during a run reverts the run, and keeps the edit before it', async () => {
    vi.spyOn(api.chem, 'optimizeStep').mockImplementation(() => Promise.resolve(shrink() as never));
    // something to undo: the run itself only previews
    S().commit('Move 1 atom', { ...S().doc, name: 'moved' });
    const before = S().doc;
    armed();
    useToolStore.getState().update('autoOptimize', { running: true });
    await vi.waitFor(() => expect(S().doc).not.toBe(before));

    undoEdit();
    expect(useToolStore.getState().autoOptimize.running).toBe(false);
    // the run is one step: undoing it gives back the document it started from, not the one before
    expect(S().doc.name).toBe('moved');
    expect(S().doc.atoms.map((a) => a.position)).toEqual(before.atoms.map((a) => a.position));
    expect(S().undoLabel()).toBe('Move 1 atom');
    expect(S().redoLabel()).toBe('Auto-optimize');
  });

  test('a run started on one structure stops when another is loaded', async () => {
    vi.spyOn(api.chem, 'optimizeStep').mockImplementation(() => Promise.resolve(shrink() as never));
    const before = S().doc;
    armed();
    useToolStore.getState().update('autoOptimize', { running: true });
    await vi.waitFor(() => expect(S().doc).not.toBe(before));

    S().load(normalizeStructure({ name: 'other', atoms: [makeAtom('C', [0, 0, 0])] }));
    expect(useToolStore.getState().autoOptimize.running).toBe(false);
  });

  test('a force field that cannot be set up stops the run and says so once', async () => {
    const step = vi
      .spyOn(api.chem, 'optimizeStep')
      .mockRejectedValue(new Error('MMFF94 could not be set up'));
    armed();
    useToolStore.getState().update('autoOptimize', { running: true });
    await vi.waitFor(() => expect(useToolStore.getState().autoOptimize.running).toBe(false));
    expect(useToolStore.getState().autoOptimize.message).toMatch(/could not be set up/);
    expect(step).toHaveBeenCalledTimes(1);
  });
});

test('double-click resets the view, and on an atom centres on it instead', () => {
  // Avogadro's Navigate tool resets the view on any double-click
  // (libavogadro/src/tools/navigatetool.cpp:192-210, camera()->initializeViewPoint()).
  // Here empty space does that and an atom centres, which is the more useful half of it.
  host.doubleClick(ev(...at(-3, -2)));
  expect(renderer.fitted).toBe(1);
  expect(renderer.controller.pivot.toArray()).toEqual([0, 0, 0]);

  host.doubleClick(ev(...at(1.5, 0)));
  expect(renderer.fitted).toBe(1);
  expect(renderer.controller.pivot.toArray()).toEqual([1.5, 0, 0]);
});
