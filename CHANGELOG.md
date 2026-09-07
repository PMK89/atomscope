# Changelog

## Unreleased

- A sweep can **continue every point from one reference calculation** instead
  of starting each from scratch. Not only faster: every point then begins
  from the same electronic state, so the curve shows the parameter rather
  than N independent convergences.
- A fork that cannot find a restart file to continue from no longer leaves an
  empty calculation behind in the project.

- **COOP: crystal-orbital overlap populations**, plotted under the density of
  states in a chart of their own — positive where two orbitals are bonding,
  negative where they are antibonding. With them come `!ORB` weights: the
  density of states of one named orbital, optionally in a frame whose z axis
  points at a neighbour, which is the only frame in which a lone pair or an
  sp3 lobe means anything.
- A density of states already computed for a calculation is read back when
  the project is reopened, instead of the panel offering to compute it again
  and overwriting the control file it was asked for.

- **A Sweeps panel**, with `/api/sweeps` behind it: pick a sweep, run the
  points that have not run, and read the curve — with the answer a
  convergence test is actually asking for stated in words ("settled from
  16 angstrom onwards, within 1.00 mH") rather than left to be judged by eye.
- Chart axis ticks take their precision from the spacing between ticks
  instead of a fixed four significant digits, so two neighbouring ticks can
  no longer print the same number.
- Collecting a calculation's results a second time replaces its result
  structure instead of adding another copy to the project.
- **Sweeps: several calculations that differ in one way, read back as one
  curve.** A convergence test, an energy-against-volume curve, a scan. What
  varies is either one schema value or the structure itself — a cell-size or
  volume sweep moves the lattice, which no schema value can express.
  Membership lives on each calculation, so a sweep is a view over the project
  rather than a second thing to keep in step with it, and a project written
  before sweeps existed still loads.
- CP-PAW protocols now yield the two plane-wave counts (wave function and
  density) as scalar properties. A cutoff or a cell size means nothing without
  them, which is why the tutorial's convergence tables ask for both beside
  every energy.

- **Periodic grids are drawn around their molecule, not inside out.** CP-PAW
  writes a grid over the unit cell starting at the cell's own origin, and a
  molecule placed at that origin therefore has its density split across the
  grid boundary — lobes at the corners of the box and nothing in the middle.
  Density and orbital cubes are now rolled by a whole number of voxels so the
  structure sits in the middle of the grid. The roll is exact: no
  interpolation, no value changes, only which index each value sits at, with
  the origin moved to match. The rewritten cube also carries the real
  structure instead of the periodic image atoms CP-PAW lists beside it.

- **A drag now turns about what you are looking at.** Rotation used to swing
  the view around the centre of the structure wherever that had ended up,
  which is what made it feel unpredictable after a pan or a zoom. It now turns
  about a reference point chosen when the drag starts: the selection if there
  is one, otherwise the atom the drag started on, otherwise the barycentre of
  the atoms weighted towards the middle of the view. The last two are
  Avogadro's own rule (`navigatetool.cpp:78-105`); putting the selection ahead
  of them is ours.

- **Export dialog: reopening it no longer wipes the path.** The dialog is hidden
  rather than unmounted, so a second Export starts with the last path still in
  the box -- and the defaults, applied a tick after the reopen, dropped it. The
  writers are only fetched once now, and a reopen applies the defaults at once.
  A controlled input given the value it already holds fires no change event, so
  re-entering the same path could not undo the wipe and Save stayed disabled.

- A **TeraChem input generator**, with the seven theories, seven basis sets,
  four dispersion corrections and three run types its dialog offered -- and the
  geometry file the deck names. Avogadro wrote a `coordinates` line pointing at
  a file it never produced (for a molecule that had never been saved, at a file
  that could not exist), so the deck alone ran nothing; here the XYZ or PDB is
  written beside it.

- A **Dalton input generator** -- and it writes the pair of files Dalton
  actually reads. Avogadro built the molecule file and the input file in one
  buffer and saved them concatenated under a single `.dal`, which Dalton
  cannot open; here they are `<name>.mol` and `<name>.dal`. Three theories,
  sixty-eight functionals, four grid qualities, both properties, the direct
  and parallel switches, and all eleven basis lists the family and its three
  switches choose between -- including aug-cc-pCV5Z, which Avogadro's switch
  had no case for and which therefore wrote aug-cc-pCVDZ. `Nosymm` is written
  only for the excitation run that asks for it, rather than leaking out of the
  property box into a plain wave-function run. That dialog has no geometry
  optimization at all, and the form says so instead of writing one -- and no
  charge or multiplicity box either, so an anion or a radical raises a warning
  naming what the deck could not carry rather than being written as neutral.

- **ORCA has both modes of its dialog now**, not a simple-input line through
  ASE. Basic mode is its four methods and four basis sets; Advanced mode adds
  the functional, the auxiliary bases, the grids, chain-of-spheres exchange,
  the SCF accuracy, the relativistic treatment, and a `%scf` block with the
  iteration limit, damping, level shifting and both convergers -- plus
  `%output` when there is something to print. Neither of Avogadro's Z-matrix
  layouts produced a deck ORCA could read (they wrote another program's syntax
  and never closed the block), so both write ORCA's own; `ExtremSCF` gets its
  missing `e` and the PBE0 functional its zero; and the augmented-Hessian
  converger, whose keyword Avogadro left commented out, now says that it
  reaches nothing rather than quietly doing so. The free-text method and basis
  boxes belong to Gaussian alone now: a value stored in them for another
  program raises a warning saying which box that program reads instead.

- **NWChem writes its own dialog's deck now**, not ASE's, with the four
  theories and nine basis sets Avogadro offered, all three coordinate layouts,
  the frozen cores MP2 and CCSD ask for and the `spherical` keyword Dunning's
  sets need. Three things are repaired: the multiplicity used to reach only the
  DFT block, so a doublet under HF, MP2 or CCSD was written into a deck that
  said nothing about spin -- an open shell now writes `scf` / `nopen`; and a
  compact Z-matrix both named itself on the wrong line and never closed the
  block it opened. Its method and basis are the dialog's lists rather than free
  text, as they are for every other generator written from its dialog.

- A **Molpro input generator**: the deck Avogadro's dialog wrote, with its five
  theories, ten basis sets, three coordinate layouts and the version box that
  chooses between the pre-2009.1 dialect and 2009.1. A reference block is
  written for every theory but B3LYP and the theory's own for every theory but
  Hartree-Fock, so a correlated run carries both. Its compact Z-matrix switched
  symmetry off in neither way at 2009.1 while the verbose one did -- the same
  geometry in the same version was reoriented in one layout and not the other,
  and both switch it off now. Asking for frequencies optimizes first, as it did
  there, and the form says so rather than leaving it to be discovered.

- **A radical is no longer written as a singlet.** An odd number of electrons
  cannot pair up, and every input generator but the GAMESS-US one wrote
  multiplicity 1 for a structure that named none -- so a methyl radical came
  out as `0 1`, a deck the program refuses or, worse, runs as a different
  molecule. The smallest multiplicity the electron count allows is now filled
  in wherever nothing else has said, and a multiplicity that *is* asked for is
  written as asked but checked: an odd electron count needs an even
  multiplicity, and the form says so when it does not have one.

- A **GAMESS-UK input generator**: the directive file Avogadro's dialog wrote,
  with its four run types, three theories, six functionals, six basis sets and
  the direct-mode switch. It is the second generator that writes a
  **transition-state** deck (`runtype saddle`), so the refusal the other
  generators give now names both. Four things are repaired rather than
  inherited -- most of all two basis labels that named a polarization the deck
  never asked for (`6-31G(d)` wrote `6-31G`, `6-31G(d,p)` wrote `6-31G*`), and
  `runtype optimze`, a typo GAMESS-UK does not read. Its theory box had no UHF or GVB
  entry, so the deck writes `scftype rhf` whatever the multiplicity -- above a
  singlet that now raises a warning saying so.

- **File > Export no longer loses a path typed while it is still loading.** The
  dialog fetches the list of formats when it opens, and the defaults it applied
  when that list arrived overwrote whatever had been typed in the meantime,
  leaving the path empty and Save greyed out. A path that is already in the box
  now survives, and chooses the writer by its extension exactly as it does once
  the list is there. This was also the e2e suite's one intermittent failure.

- A **Psi4 input generator**: the psithon script Avogadro's dialog writes -- a
  `set basis` line, a `molecule {}` block and the call that runs the job -- with
  its nine theories and five basis sets. Three things there are repaired rather
  than inherited: the dialog's title box reached no output at all, so ours writes
  it as a comment; `set basis` came out with two spaces; and Reset put the form
  back to something the dialog never opened with. Its default theory is
  Hartree-Fock rather than the dialog's SAPT0, because a SAPT deck is an
  interaction energy that Psi4 refuses for a single molecule -- choosing one for
  a structure that holds one fragment says so instead.

- A **Q-Chem input generator**, with the theory and basis lists of Avogadro's
  dialog and the same three coordinate layouts as the Gaussian one. MP2 and CCSD
  are written as a Hartree-Fock reference with a correlation keyword beside it,
  and the two effective core potentials reach `ECP` rather than `BASIS`, which is
  what Q-Chem reads.

- The **editor tools, the display layers, the dock panels and the menu items are
  plugins now**. Nothing enumerates them any more: the toolbar, the status bar,
  the settings box, the input host, the renderer, the dock's tab strip and the
  menu bar all ask a registry, and everything the application ships registers
  into it through the same calls a plugin would use. An extension contributes a
  menu entry by naming the menu it belongs under — one that is there, or one of
  its own — and edits the document through the same undo history as everything
  else, so its command appears in Undo under the name it gave. Colour schemes
  are contributed too, and **Settings > Plugin manager** lists everything that
  is registered, by kind, with a switch and a description each — switching one
  off takes the tool off the toolbar, the layer out of the running view, the
  panel's tab off the dock, the menu entry out of its menu or the scheme out of
  the `Colour by` list, at once rather than at the next start. Two cannot be
  switched off, because they are what the others fall back to: the navigate tool
  and the element colour scheme. A tool brings its own settings panel, says whether it
  leaves the camera its drags and what cursor it wants, and its id is any string
  rather than one of eight; a panel brings its own tab. Avogadro's plugins were shared libraries loaded at
  start-up; a browser bundle has no such loader, so a plugin here is a module and
  adding one means a rebuild.

- The **GAMESS-US input generator** gained the Basic Setup tab of Avogadro's
  dialog: the theory list (AM1 and PM3 are Hamiltonians there and replace the
  basis set), the nine-entry basis list with the keywords each entry stands
  for, water as a PCM solvent, and a transition-state search. Its deck is
  written here now, so `Memory` reaches `$SYSTEM MWORDS` and extra keywords
  pass through as a line of their own. `Set the basis in detail`, under advanced
  options, is that dialog's Advanced Basis tab: the long basis list, #D/#F/#P
  polarization functions and where their exponents come from, the diffuse
  shells, and the effective core potential. The Control tab is there too:
  GAMESS's own run-type list (IRC, Raman, NMR, energy surfaces and the rest),
  UHF/GVB/MCSCF, CI and coupled cluster, the localization methods, the SCF
  iteration limit and `Check`/`Debug` runs. So are the Data tab (the deck's
  title, the point group and the order of its axis, the coordinate type, Bohr or
  Ångström — and the coordinates really are converted, which Avogadro's were
  not), the DFT tab (both of GAMESS's functional lists, grid or grid-free), the
  Misc tab (the interfaces to
  MolPlt, PltOrb, AIMPAC and RPAC, and writing another program's input instead
  of running), the MO Guess tab (where the
  initial orbitals come from, whether to print them, and the alpha/beta mixing
  a singlet UHF run uses), the Hessian tab (analytic or numerical force
  constants, the displacement, the purification and the frequency scale
  factor), the SCF tab (a direct SCF,
  Fock differencing, UHF natural orbitals and a convergence criterion), the MP2
  tab (the frozen core, memory, the integral cutoff, localized orbitals, MP2
  properties and where the AO integrals live), the Stat Point tab (the
  optimization method, its step sizes, the initial Hessian and how often to
  recompute it) and the System tab (a time limit, distributed memory, the
  diagonalization and the load balance). **The free-text `Method` and `Basis set`
  boxes no longer apply to GAMESS**: it has its own lists, so a stored GAMESS
  calculation that carried, say, `basis: N311` regenerates from the new boxes
  and their defaults (RHF/6-31G(d)) unless you set them. Every other program is
  unaffected. The GAMESS controls sit in a box per Avogadro tab
  rather than in one column of sixty-odd fields; a box with
  nothing to show does not appear at all, so every other program's form is the
  length it was.

- The **Gaussian input generator** gained the options Avogadro's dialog had:
  processors and memory, a checkpoint file named after the deck, the Output box
  (Molden and Molekel add the keywords that make the log readable as a
  wavefunction), and the Format box — Cartesian or either of the two Z-matrix
  layouts. A semi-empirical method drops the basis set from the route line,
  which is what makes `#n AM1 SP` a calculation and `#n AM1/6-31G(d) SP` not
  one.

- Surfaces can be generated from a **Molpro output** as well. Molpro names
  every basis function it prints, so the components are ordered by those names
  rather than by a table, and a name the reader does not know stops the read.
  Checked on methane, whose four bonds have to carry the same density — which
  they do to 0.05%, and would not with the axes permuted. The file has to come
  from a run without point-group symmetry; a symmetrized or generally
  contracted one is refused rather than misread.

- Surfaces can be generated from an **ORCA output** — the ordinary `.out`, with
  the orbitals printed in it — beside the Molden file `orca_2mkl` writes. An
  optimization gives its converged step. The two readings of one job were
  checked against each other: same geometry, same basis, and every orbital
  coefficient agreeing to half the last printed digit.

- Surfaces can be generated from a **GAMESS-US log**, beside Gaussian
  checkpoints and Molden files: the geometry, the basis and the orbitals are
  read from the log itself. Molden files written by ORCA (`orca_2mkl`) now read
  correctly too — ORCA uses a different coefficient convention from the one the
  format describes, which had been leaving its orbitals subtly mis-shaped. The
  convention is measured from the basis, two independent ways that have to
  agree, and the panel says which one the file turned out to be in.

- The dipole moment is drawn: one red arrow through the molecule, summed from
  the partial charges every time the picture is rebuilt, so it follows an atom
  you drag. `View ▸ Show dipole moment`, or the Display tab, which also shows
  the magnitude.

- The Cartesian editor gained a **Format** box — the seven column layouts
  Avogadro offered (XYZ, XYZ with numbers, coordinates only, GAMESS, GAMESS #2,
  Turbomole, Priroda) — and a **Sort by** box for element or a coordinate.
  What you paste in is read by its shape whatever the box says. Sorting
  renumbers the atoms of the structure in one undo step, carrying the bonds,
  the per-atom properties, the constraints, the residues and the selection with
  them.

- `Set space group…` in the Crystal tab lists all 530 settings of the 230
  space groups — International number, Hall symbol, Hermann-Mauguin symbol and
  the setting — and `Fill cell` then uses the one you picked exactly, including
  the unique-axis settings that an International number alone cannot express.

- A file that was drawn rather than computed -- a molfile from a sketcher, a
  2D database record -- is offered a rough 3D geometry when it is opened, built
  from the bonds and cleaned up with a force field. It is one undo step, and
  `Build ▸ Generate 3D coordinates` builds one whenever you ask.

- A wavefunction surface is computed beside the request rather than inside it:
  the panel shows how far it has got and can stop it, and a cancelled
  evaluation really ends the arithmetic instead of only ending the wait. Every
  field can be stopped, including the densities and the potential; a field
  built out of two others moves the bar once rather than twice; and anything
  that goes wrong, in the arithmetic or in writing the dataset, is reported on
  the panel rather than leaving it counting.

- Tool settings, the active tool and the open dock tab are remembered between
  sessions in this browser. View settings still travel with the project: one
  describes how you work, the other how a structure is shown.

- The bond-centric tool bends angles: with a bond selected, dragging an atom
  next to it changes the angle it makes with the bond, drawn beside the atom as
  it turns. An angle inside a ring says so rather than tearing the ring open.

- The Properties tab can look a compound's IUPAC name up at PubChem, by the
  InChIKey computed here — the structure itself never leaves.

- The Properties tab tells more of the story: molecular weight, residue count
  and any quantity the document carries (the dipole from a partial-charge run,
  an imported output's energy) in the structure section; Open Babel's atom
  type, both readings of valence and an editable partial charge for the
  selected atom.

- A file dropped on the window opens it. A drop of several files opens the
  first and says so, since one document is open at a time.

- Replacing the open document — New, Open…, Open Recent, a fetch, Build from
  SMILES, a trajectory import or a dropped file — asks first when there is
  unsaved work, because loading clears the undo history.

- The Spectra panel exports: the plotted curve and the mode table as
  tab-separated values, and the plot as PNG or SVG. An exported plot is always
  written in the light palette on white, whatever theme the application is in.

- The Cartesian editor reads and writes Ångström, Bohr or fractional
  coordinates; fractional is offered only when the structure has a unit cell.

- A bond can be selected on its own (Select ▸ Mode ▸ Atoms and bonds): it is
  tinted whole and counted in the status bar, rather than standing for the atoms it joins.

- Any background colour (Settings ▸ Preferences ▸ Background ▸ Custom…), and
  View ▸ Centre, which re-centres the structure without changing the zoom.

- Recent files in the File menu, with Clear recent. The list is kept by the
  backend, so it survives opening another project and reloading the page.

- Fetch a structure by identifier: `File ▸ Fetch from PDB…` (RCSB) and
  `Fetch by name…` (PubChem). Two fixed hosts, an identifier rather than a URL, allowlisted
  redirects and a size and time bound — see docs/architecture/security-model.md.

- Named selections: name the current selection, recall it from the Select
  menu, rename or remove it. A set names its atoms by uid, so it survives an edit.

- Pasting a VASP POSCAR: recognised by its lattice, and when it does not name
  its elements (VASP 4 kept them in the POTCAR) a dialog asks which element each species is.

- Display scope: a colour per atom as well as a display type, painted over whatever colour scheme
  is chosen, and hidden atoms are now left out of the ribbon and the hydrogen bonds too.

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
- `File ▸ Export POV-Ray scene`: the viewport as a ray-tracer's source file — spheres, cylinders,
  cones and triangle meshes, the camera, one light and the background — written from the scene the
  layers drew, so it is what is on screen. Labels, the unit-cell box and the axes gizmo are not in
  it, and a mesh's per-vertex colours are flattened.
- Angle and torsion tables on the Properties tab, both editable: typing an angle turns the far
  side about the vertex, typing a torsion turns it about the central bond, and a value inside a
  ring says why it cannot be driven.
- The residue colours are now a choice of Jmol's three tables — amino, shapely or hydrophobicity —
  for the atoms and for the ribbon, and each paints an unknown residue with its own colour. The
  nucleic bases changed with them: they are Jmol's colours now (adenine pale blue rather than dark
  red), the same under all three palettes.
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
