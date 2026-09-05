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
  `editor/` or on the backend (valence, hydrogens, bond perception are backend services so the
  rules exist once).
- The renderer is framework-agnostic; `Viewport.tsx` is the only bridge between React and
  Three.js.
- Forms are rendered from `ParameterSchema` JSON (`ui/forms/SchemaForm.tsx`); adding a backend
  parameter never requires a frontend change.
- Long-running work (parsing large files, marching cubes) runs in Web Workers with transferable
  buffers.
