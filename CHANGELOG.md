# Changelog

## Unreleased

- Wavefunction surfaces: Gaussian fchk and Molden readers, molecular orbital / electron density /
  spin density / electrostatic potential / van der Waals fields on a grid, and a Create surfaces
  panel that shows the grid cost before the request.
- Vibrations and spectra: normal modes from any ASE calculator, IR intensities, Gaussian/Lorentzian
  broadening, Gaussian/ORCA/Q-Chem output and TSV/JCAMP-DX/Turbomole spectrum readers, a Spectra
  dock panel with mode animation.
- Molecular point groups (detection, group order and Symmetrize with Loose/Normal/Tight tolerance)
  and SMARTS selection, both reachable from the UI.
- Crystallography (cells, spglib symmetry, builders, library), molecular mechanics (Open Babel force
  fields, hydrogens, pH, properties) and CP-PAW analysis (DOS, band structure, orbital export).
- Frontend review pass: periodic bond perception, a bounded marching-cubes budget, ARIA menus and
  dock tabs, undo during a preview gesture, throttled picking.
- Documentation: user guide, three tutorials, developer guide and a rewritten README.
- Performance harness (`backend/benchmarks/`, `frontend/e2e/perf.spec.ts`) and the fixes it found:
  bond perception no longer allocates an N^2 array for non-periodic structures, project JSON is
  serialised once, and placing an atom in a large document is no longer O(atoms x bonds).
  Measurements and remaining limits: docs/performance.md.
- Renderer: the sphere and cylinder tessellation is chosen from the atom count, which is what makes
  a large structure orbit at all.
- Fixed: Ctrl+C with text selected in a panel copied the molecule instead of the text; removing
  atoms in the editor left residues and constraints pointing at the old numbering; a copied
  fragment carried no residues.
- The frontend type-checks again: the project references mean a bare `tsc --noEmit` checks nothing,
  which had hidden 37 errors (`normalizeStructure` demanding fields it fills in itself, spectrum
  requests missing fields the generated types require, a vibration trajectory without its
  `structureId`, unchecked tuple indexing in the cell-extent maths, several test casts).
- Adding hydrogens to a PDB structure no longer drops its residues: a new hydrogen joins the
  residue of the heavy atom it is bonded to, so the ribbons, residue labels, residue selection and
  residue colours survive `Add hydrogens`.
- Deleting atoms now takes their per-atom properties with them: partial charges and forces used to
  keep the old length and were then silently ignored by everything that reads them.
- The residue colours are now a choice of Jmol's three tables — amino, shapely or hydrophobicity —
  for the atoms and for the ribbon, and each paints an unknown residue with its own colour.
- A MOPAC input generator (`qc_inputs` ▸ Program: MOPAC): the semi-empirical Hamiltonian
  (AM1, PM3, PM6, PM7, RM1, MNDO, MNDO-d) in place of a method and a basis set, single point,
  optimization or FORCE, and the charge and multiplicity the structure carries.
- `File ▸ Export…`: one dialog over every format the backend can write (ASE, RDKit and Open Babel
  -- xyz, extxyz, cif, pdb, vasp, mol, sdf, xsf, json, gaussian-in, turbomole, espresso-in, cml,
  smi), with the format and the file name following one another, and a write to a path on this
  machine or a download. It replaces the three fixed Export items, and it will not write over an
  existing file until asked a second time.
- A colour map per engine: the ribbon can be coloured by secondary structure, chain or residue,
  independently of what the atoms are coloured by (isosurfaces already had one of their own).
- More colour maps on the Display tab: atom index and distance from the first atom (the rainbow
  sweep Avogadro uses), partial charge (red negative, blue positive, scaled by the largest in the
  structure) and a single colour of one's own.
- Display scope (Avogadro's Objects tab): a display type per atom, assigned to the selection, with
  `Display only selection`, `Hide selection` and `Show all`. Hidden atoms are not drawn, labelled or
  pickable, and the assignment is keyed by atom uid, so it survives edits, optimizations and undo.
- A `Settings ▸ Preferences…` dialog: rendering quality, depth cueing (fog), projection,
  background, and the backend list with what each one found on the machine. Depth cueing is turned
  off for a transparent image export, where fading towards the background colour would leave a halo.
- Residue-aware selection and colouring: `Select ▸ Select residues…` (names, numbers, ranges,
  chain-qualified) and `Select ▸ Select solvent`, and a `Colour by` on the Display tab with
  residue (RasMol amino colours), chain and secondary-structure schemes.
- An Auto-optimize tool (`O`): the force field runs continuously and an atom can be dragged while
  it does, pinned where it is held while the rest of the molecule relaxes around it. One request in
  flight at a time, and the whole run is a single undo step -- Undo during a run stops it and
  reverts the run itself rather than taking the edit before it along.
- A bond properties table on the Properties tab: every bond (or every bond of the selection) with
  its order, whether it can rotate, and an editable length. A bond across a periodic boundary
  reports its minimum-image length (read-only), as does the per-atom bond list above it.
- A Constraints dialog (Extensions > Constraints...): ignored and fixed atoms, fixed Cartesian
  axes, and distance, angle and torsion constraints with an optional target value, added from the
  selection, saved with the document and honoured by geometry optimization. The data model gained
  `fix_angle`, `fix_dihedral` and `ignore_atoms`, and bond/angle/torsion constraints gained a
  target value; all of them survive an ASE round trip and are re-indexed when atoms are removed.
- Escape and Tab now behave the same in every modal dialog (one `dialogKeyHandler`); the Help
  dialog had no focus trap.
- A document with a fixed bond length no longer makes Optimize geometry fail: the constraints are
  derived from the structure the request already carries, where the target value can be measured.
- A surface can be coloured by a second grid (an electrostatic potential mapped onto an electron
  density). The automatic scale is symmetric about zero, so white on the surface means zero; the
  scale can also be typed in. Sampling allocates nothing per vertex and a range change recolours
  the cached samples instead of sampling the grid again.
- File > Open… is a dialog now: a path on this machine or an uploaded file, with the format
  detection overridable and the picker filtered to the readable extensions.
- File > Export image…: the viewport at 1x, 2x or 4x its size, as PNG (optionally with a
  transparent background) or JPEG, including the axes gizmo, with sizes the GPU cannot render
  left out of the list.
- Repeating the unit cell now repeats the atoms and bonds in it, not just the box, and fitting
  the camera frames the repeats.
- A Select menu (the selection commands moved out of Edit) and a Help menu: the guides, the
  tutorials, the keyboard shortcuts and what the program is.
- Double and triple bonds are drawn as two or three parallel sticks, in the plane of the molecule,
  with a toggle in the Display tab; RDKit-derived structures are kekulized so an aromatic ring has
  bond orders to draw.
- File > Save (Ctrl+S) and Save as… (Ctrl+Shift+S): Save as writes a copy under a new id and
  continues editing it, so an optimized or supercelled structure no longer overwrites its source.
  Unsaved work is marked in the window title and the status bar, and leaving the page asks first.
- Hydrogen bonds as dashed sticks, with cut-off distance and angle in the Display tab, computed
  from the displayed geometry so they follow a trajectory.
- Protein ribbons and cartoons: a spline through the alpha carbons, oriented by the carbonyls,
  drawn from the secondary-structure assignment (helices red, strands yellow with an arrowhead,
  coil thin) with Cartoon/Ribbon/Backbone rendering in the Display tab.
- Fixed: inserting a fragment dropped every residue of the document, so an inserted peptide had no
  residues to label, select or draw a ribbon for.
- Protein secondary structure: a DSSP implementation (backbone perception from connectivity,
  Kabsch-Sander hydrogen bonds, turns and bridges) behind `POST /api/chem/secondary-structure`,
  verified against 1CRN's own HELIX/SHEET records. PDB import now fills residues and atom names.
- Cut, copy, paste and clear (Edit menu, Ctrl+X/C/V, Ctrl+Backspace). A fragment copied inside
  Atomscope keeps its bond orders; XYZ goes to the system clipboard for other programs, and text
  pasted from elsewhere (XYZ, CIF, PDB, molfile, CML, SMILES) is read by `POST /api/io/import/text`.
- Labels: atom and bond labels (index, symbol, name, formal and partial charge, residue, custom;
  bond order, length) as billboarded sprites, with colour, size and offset.
- A Display tab in the right dock collects every display layer -- structure style, atom and bond
  radius, hydrogens, labels, vectors, unit cell repeat and axes -- in one place, and can give the
  selected atoms a display type of their own (Avogadro's per-primitive engine restriction).
- Chemistry and building reach the UI: an Extensions menu for hydrogens, pH, bond perception,
  MMFF94 optimization (honouring the document's constraints), partial charges, Copy as SMILES/InChI,
  chirality and H to methyl; Build > Insert dialogs for the fragment library, peptides, nucleic
  acids and nanotubes; NMR, UV-Vis and CD spectra.
- Fixed: band structures were drawn per k-point instead of per band; cancelling a CP-PAW run
  waited the full 90 s soft-stop grace because the signal handler could not observe the child
  exit; a stale band file could be served as the result of a failed run; `orbital_bands` silently
  dropped ranges like "1-4"; the electrostatic potential could allocate tens of gigabytes;
  JobConsole could loop forever on a fresh selector array.

- Phase 0 investigation: Avogadro 1 feature-parity matrix, CP-PAW analysis, ASE/asecppaw analysis.
- Scientific data model, units, ASE bridge, project store, IO registry (ASE/RDKit/Open Babel), bond perception.
- Schema-driven parameter engine, JobManager, calculation service, REST/WebSocket API with generated TS types.
- Backend plugins: ASE built-in calculators; CP-PAW (input generation, driver, parsing, cube export).
- Frontend: Three.js renderer, undoable structure store, menubar, project/calculation panels, job console.
