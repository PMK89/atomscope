## Review outcome

No files were modified. This is a static, read-only audit pinned to revision `3640d98`; the repository changed during review, so I avoided conclusions about concurrently edited files.

### Findings

1. **High — client bond perception disagrees with the backend for periodic structures.**  
   [frontend/src/model/connectivity.ts:95](/home/pmk/Projects/atomscope/frontend/src/model/connectivity.ts:95) uses direct Cartesian distance and ignores the unit cell/PBC. The backend [bonds.py:25](/home/pmk/Projects/atomscope/backend/src/atomscope/chem/bonds.py:25) uses ASE neighbour lists, including periodic images. Yet [frontend.md:22](/home/pmk/Projects/atomscope/docs/architecture/frontend.md:22) claims the same rule. Bonds across cell boundaries will be missed client-side.  
   Fix: implement minimum-image distances for periodic axes and a cell-aware neighbour search, or delegate perception to the backend; add orthogonal and triclinic cross-boundary tests.

2. **High — click-to-add can over-coordinate existing atoms when Adjust Hydrogens is enabled.**  
   [DrawTool.ts:71](/home/pmk/Projects/atomscope/frontend/src/editor/tools/DrawTool.ts:71) auto-perceives bonds for a newly clicked atom, but [DrawTool.ts:133](/home/pmk/Projects/atomscope/frontend/src/editor/tools/DrawTool.ts:133) adjusts hydrogens only on that new atom. If it bonds to an already saturated carbon, the old carbon retains four H atoms and gains a C–C bond.  
   Fix: adjust the new atom and all newly bonded neighbours as one immutable operation. Add the “click C near methane yields ethane, not C₂H₇” regression test.

3. **High — an unrelated trajectory can override the displayed structure solely by atom count.**  
   [Viewport.tsx:27](/home/pmk/Projects/atomscope/frontend/src/ui/Viewport.tsx:27) creates overrides for any loaded trajectory; [StructureLayer.ts:107](/home/pmk/Projects/atomscope/frontend/src/renderer/layers/StructureLayer.ts:107) accepts them when `positions.length === atomCount * 3`. Symbols, source structure, and bond topology are not checked. The UI’s frame-load path does validate symbols in [trajectory.ts:129](/home/pmk/Projects/atomscope/frontend/src/model/trajectory.ts:129), but the renderer override does not.  
   Fix: centralize `isTrajectoryCompatible()` and require atom count, ordered elements, and a structure/topology fingerprint before rendering overrides. Clear trajectories when a normal structure load replaces their source.

4. **High — every interactive preview rebuilds all atom and bond meshes.**  
   [StructureLayer.ts:99](/home/pmk/Projects/atomscope/frontend/src/renderer/layers/StructureLayer.ts:99) treats every document revision as a topology change; [StructureLayer.ts:168](/home/pmk/Projects/atomscope/frontend/src/renderer/layers/StructureLayer.ts:168) disposes/recreates `InstancedMesh` objects, while [structureStore.ts:56](/home/pmk/Projects/atomscope/frontend/src/state/structureStore.ts:56) increments revision on each `preview()`. Drag tools preview on pointer movement. At 10⁴–10⁵ atoms this is repeated allocation, GPU upload, and GC pressure per frame.  
   Fix: separate topology/style revisions from coordinate changes; preserve meshes and update only instance matrices for coordinate previews.

5. **High — hover picking raycasts every atom/bond instance on every pointer move.**  
   [ToolHost.ts:87](/home/pmk/Projects/atomscope/frontend/src/editor/ToolHost.ts:87) picks during ordinary pointer movement; [Renderer.ts:147](/home/pmk/Projects/atomscope/frontend/src/renderer/Renderer.ts:147) invokes Three.js raycasting on instanced atoms and bonds. Three’s `InstancedMesh.raycast` iterates instances, so this is O(N+B) per hover event.  
   Fix: implement the already-documented GPU ID-buffer picker, or use a screen-space/BVH candidate index and throttle hover. Keep full raycasts only for a narrowed candidate set.

6. **High — isovalue slider changes queue obsolete marching-cubes jobs rather than cancelling/coalescing them.**  
   [SurfacesPanel.tsx:825](/home/pmk/Projects/atomscope/frontend/src/ui/SurfacesPanel.tsx:825) updates isovalues on each range-input event. [IsosurfaceLayer.ts:81](/home/pmk/Projects/atomscope/frontend/src/renderer/layers/IsosurfaceLayer.ts:81) starts a new computation; it discards stale results only after the worker completes at [IsosurfaceLayer.ts:109](/home/pmk/Projects/atomscope/frontend/src/renderer/layers/IsosurfaceLayer.ts:109). Large grids therefore monopolize the single worker with obsolete work.  
   Fix: debounce slider input, compute only on release or a short idle interval, and support cancellation/coalescing in the worker.

7. **High — 10⁷-voxel surfaces have no realistic memory/triangle budget.**  
   [IsosurfaceLayer.ts:59](/home/pmk/Projects/atomscope/frontend/src/renderer/layers/IsosurfaceLayer.ts:59) sends the input volume to Comlink without transfer ownership, while [marchingCubes.worker.ts:16](/home/pmk/Projects/atomscope/frontend/src/renderer/workers/marchingCubes.worker.ts:16) retains it. The mesher builds JS arrays/maps before typed arrays in [marchingCubes.ts:138](/home/pmk/Projects/atomscope/frontend/src/renderer/marchingCubes.ts:138), with no vertex cap. A pathological field can exhaust browser memory.  
   Fix: add an explicit memory/triangle estimate and limit, progressive/downsampled previews, typed chunked output, and a deliberate buffer-ownership design (transfer/shared ownership without detaching required UI data).

8. **Medium — downsampling omits the final grid slab unless dimensions divide exactly by the step.**  
   [marchingCubes.ts:104](/home/pmk/Projects/atomscope/frontend/src/renderer/marchingCubes.ts:104) samples `0, step, 2*step…` and calculates the coarse size with `floor`. For a dimension of 6 and step 4, index 5 is never sampled; a contour confined to the final physical slab is lost. Existing tests use divisible dimensions.  
   Fix: construct sampled-index arrays that always include `n - 1`, and support a shorter final stride in coordinate and gradient calculations.

9. **Medium — undo/redo during a live preview can commit against a stale history base.**  
   [structureStore.ts:56](/home/pmk/Projects/atomscope/frontend/src/state/structureStore.ts:56) retains `previewBase`; [structureStore.ts:70](/home/pmk/Projects/atomscope/frontend/src/state/structureStore.ts:70) and [structureStore.ts:81](/home/pmk/Projects/atomscope/frontend/src/state/structureStore.ts:81) do not clear it on undo/redo. A global Undo during a drag followed by pointer-up can record the stale pre-drag document as the undo predecessor.  
   Fix: cancel/reset preview state before undo/redo and abort the active tool gesture. Add a regression test for undo/redo while dragging.

10. **Medium — pre-existing surface state can fail to mount into a newly created renderer.**  
    [useIsosurfaceLayers.ts:15](/home/pmk/Projects/atomscope/frontend/src/ui/useIsosurfaceLayers.ts:15) depends on a stable ref object; [Viewport.tsx:37](/home/pmk/Projects/atomscope/frontend/src/ui/Viewport.tsx:37) calls it before the effect that creates `rendererRef.current`. If grids/surfaces already exist, the hook returns early and may not rerun until another store change.  
    Fix: expose renderer readiness as React state and depend on that renderer instance, not solely on `rendererRef`.

11. **Medium — global Undo/Redo hijacks text-field editing.**  
    [MenuBar.tsx:114](/home/pmk/Projects/atomscope/frontend/src/ui/MenuBar.tsx:114) handles Ctrl/Cmd-Z and Ctrl/Cmd-Y globally; its editable-target guard is only used for Select All. In Cartesian or calculation forms, native text undo can instead undo molecular edits.  
    Fix: return early for editable targets for Z/Y/A shortcuts, unless an explicit form-independent shortcut is intended; test input undo behavior.

12. **Medium — accessibility semantics are incomplete for core menus, tabs, and modal editing.**  
    [MenuBar.tsx:23](/home/pmk/Projects/atomscope/frontend/src/ui/MenuBar.tsx:23) has menu roles but lacks keyboard menu behavior, `aria-expanded`/`aria-haspopup`, Escape handling, and appropriate checked-item roles. [RightDock.tsx:18](/home/pmk/Projects/atomscope/frontend/src/ui/RightDock.tsx:18) tabs lack panel associations. [CartesianEditor.tsx:590](/home/pmk/Projects/atomscope/frontend/src/ui/CartesianEditor.tsx:590) lacks modal focus management and `aria-modal`.  
    Fix: implement roving menu focus, Escape and arrow navigation, correct ARIA relationships, focus trap, and focus restoration.

13. **Medium — integer scientific parameters are silently truncated.**  
    [SchemaForm.tsx:69](/home/pmk/Projects/atomscope/frontend/src/ui/forms/SchemaForm.tsx:69) uses `parseInt` for integer fields. Entering `2.9` becomes `2` without validation, which is unsafe for calculation input.  
    Fix: parse with `Number`, reject non-integers with an inline error, preserve raw input until valid, and test fractional integer input.

14. **Medium — Avogadro parity documentation overstates Cartesian Editor support.**  
    [avogadro1-feature-parity.md:74](/home/pmk/Projects/atomscope/docs/avogadro1-feature-parity.md:74) marks the feature IMPLEMENTED, but [CartesianEditor.tsx:593](/home/pmk/Projects/atomscope/frontend/src/ui/CartesianEditor.tsx:593) presents Å-only editing and [cartesian.ts:18](/home/pmk/Projects/atomscope/frontend/src/editor/cartesian.ts:18) supports only the simple element/x/y/z form. The Avogadro reference scope includes Bohr/fractional units and several formats.  
    Fix: mark this PARTIAL until units/formats are implemented, or explicitly narrow the claimed parity.

15. **Low — the frontend architecture document describes components that do not exist.**  
    [frontend.md:8](/home/pmk/Projects/atomscope/docs/architecture/frontend.md:8) says workers handle parsing; [frontend.md:12](/home/pmk/Projects/atomscope/docs/architecture/frontend.md:12) lists `src/plugins`. The source has the marching-cubes worker but no parser worker or `src/plugins` registry. The transferable-buffer claim at [frontend.md:39](/home/pmk/Projects/atomscope/docs/architecture/frontend.md:39) is also not true for grid input.  
    Fix: correct the architecture document and add a source-backed ownership/lifecycle description.

16. **Low — CameraController leaves an anonymous event listener undisposable.**  
    [CameraController.ts:34](/home/pmk/Projects/atomscope/frontend/src/renderer/CameraController.ts:34) adds an anonymous `contextmenu` listener, while [CameraController.ts:40](/home/pmk/Projects/atomscope/frontend/src/renderer/CameraController.ts:40) cannot remove it.  
    Fix: retain the handler as a field and remove it in `dispose()`.

### Done well

- `dihedralDeg` has an explicit tested sign convention; I found no evidence of a sign inversion.
- Marching-cubes tests cover negative lobes, sheared axes, and left-handed grids; the ± orbital-lobe logic and normal orientation appear internally consistent.
- Hidden-hydrogen picking preserves instance-to-original atom/bond mappings in `StructureLayer`; I found no mapping error there.
- Renderer layers generally dispose replaced geometries/materials correctly.
- The immutable document plus preview/commit model is a sound basis for single-step gesture undo; the defect is specifically the undo/redo-during-preview edge case.
- [renderer.md:16](/home/pmk/Projects/atomscope/docs/architecture/renderer.md:16) accurately describes the intended layer split, and its planned GPU picker directly addresses the largest current interaction bottleneck.

A no-emit TypeScript check passed earlier in the audit. I did not execute the test suite, to keep the review strictly non-mutating; the missing regressions identified above should be added before relying on the affected features at scientific scale.