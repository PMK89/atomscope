# Renderer

`frontend/src/renderer/` wraps Three.js (WebGL2). Nothing in it depends on React.

```text
Renderer            WebGLRenderer, Scene, lights, perspective + orthographic cameras, on-demand
                    frames (invalidate()), ResizeObserver, picking, screenshots, layer list
CameraController    trackball rotation about a pivot, pan, zoom (dolly / ortho zoom), fit()
layers/Layer        DisplayLayer { id, object, visible, update(ctx), dispose() }
layers/StructureLayer  atoms as InstancedMesh spheres, bonds as two half-cylinders per bond
                    (element colors on both halves), styles ball-and-stick / stick / vdW /
                    wireframe, selection + hover tinting, hydrogen hiding, instance→atom map
math                cylinderMatrix (segment → instance transform), bond offset axis
```

`LayerContext` carries an immutable structure snapshot, its `revision`, the selection set and the
hovered atom. Layers rebuild geometry only when the revision or their settings change and
recolor cheaply otherwise.

Picking uses Three.js raycasting against the instanced atom mesh (instanceId → atom index);
`unprojectOnPivotPlane` gives world coordinates for placing new atoms in the plane through the
pivot facing the camera. Screenshots read the canvas (`preserveDrawingBuffer` is on).

Feature branches add: `IsosurfaceLayer` (marching cubes in a worker, ± lobes, transparency),
`VectorLayer` (forces, dipoles), `UnitCellLayer`, `AxesLayer`, and per-frame position overrides
for trajectory playback. Planned: GPU ID-buffer picking for very large systems, ribbons/cartoons
for biomolecules, labels via an HTML overlay, POV-Ray/glTF export.
