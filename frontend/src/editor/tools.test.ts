import { Vector3 } from 'three';
import { formula, makeAtom, makeBond, normalizeStructure } from '../model/structure';
import { useSelectionStore } from '../state/selectionStore';
import { useStructureStore } from '../state/structureStore';
import type { PickResult } from '../renderer/Renderer';
import type { PointerLike, ToolCamera, ToolRenderer } from './Tool';
import { ToolHost } from './ToolHost';
import { useToolStore } from './toolStore';
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
  pick(cx: number, cy: number): PickResult | null {
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

let renderer: FakeRenderer;
let host: ToolHost;
beforeEach(() => {
  loadSkeleton();
  renderer = new FakeRenderer();
  host = new ToolHost(renderer, createTools());
});
afterEach(() => host.dispose());

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
  test('hover updates the selection store for every tool', () => {
    host.pointerMove(ev(...at(1.5, 0)));
    expect(useSelectionStore.getState().hoveredAtom).toBe(1);
    host.pointerMove(ev(10, 10));
    expect(useSelectionStore.getState().hoveredAtom).toBeNull();
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
