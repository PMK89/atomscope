# Frontend architecture

```text
src/api        generated OpenAPI types + thin fetch client (no hand-written backend types)
src/model      normalized structure document, element data (generated), geometry helpers
src/state      zustand stores: structure (undo/redo), selection, view, jobs, calculations
src/renderer   Three.js: Renderer (scene, cameras, lights), CameraController, display layers,
               picking, math; workers/ for meshing and parsing
src/editor     interactive tools operating on the structure store (draw, select, manipulate,
               measure, navigate); each tool is a class with pointer handlers
src/ui         React components: MenuBar, Viewport, docks, panels, forms, console, status bar
src/plugins    registry for tools, layers, panels
```

Principles:

- The structure document is immutable; edits produce a new document via `commit(label, next)`,
  which is what makes undo/redo trivial and lets the renderer diff by `revision`.
- React components contain no chemistry. Geometry and chemistry rules live in `model/`,
  `editor/` or on the backend. The backend remains the authority for valence, hydrogens and
  bond perception; a deliberately minimal subset is duplicated in TypeScript so that
  interactive drawing needs no round trip: `model/connectivity.ts` guesses bonds geometrically
  with the same rule as `atomscope.chem.bonds` (bonded when d < 1.15 * (r_i + r_j), Cordero
  covalent radii) and `editor/valence.ts` carries a small valence table (H1 C4 N3 O2 F1 Si4 P3
  S2 Cl1 Br1 I1) with template-based hydrogen placement (linear / trigonal / tetrahedral; H at
  1.09/1.01/0.96 Å for C/N/O, covalent-radius sum otherwise). Anything beyond this (aromaticity,
  pH models, force fields) stays on the backend.
- Editor tools (`editor/Tool.ts`) are plain classes driven by `editor/ToolHost.ts`, which binds
  the canvas events, keyboard shortcuts and hover. Tools see a `ToolRenderer` facade (pick,
  project, unproject on a plane, camera subset) so they are unit-tested against a fake renderer.
  Drags call `structureStore.preview(doc)` for live feedback and `commit(label, doc)` once on
  pointer-up, so every gesture is a single undo step. Tool overlays (measurement lines, rubber
  band, bond labels) are returned as shapes in canvas pixels and drawn by an SVG layer
  (`ui/ViewportOverlay.tsx`); nothing tool-related is rendered inside the WebGL scene.
- The renderer is framework-agnostic; `Viewport.tsx` is the only bridge between React and
  Three.js.
- Forms are rendered from `ParameterSchema` JSON (`ui/forms/SchemaForm.tsx`); adding a backend
  parameter never requires a frontend change.
- Long-running work (parsing large files, marching cubes) runs in Web Workers with transferable
  buffers.
