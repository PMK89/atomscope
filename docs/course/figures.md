# CP-PAW hands-on course — figure-by-figure audit

Can the whole hands-on course be reproduced *and drawn* in Atomscope? This file answers that one
figure at a time. Source, licensing and the no-PDF rule are as set out in
[`inventory.md`](inventory.md): the course document is not in this repository, so each row
describes in our own words what the figure shows and cites the chapter it belongs to.

The course draws its 2D graphics with `xmgrace` (from `paw_dos.x` / `paw_bands.x` output) and its
3D pictures with POV-Ray. The user's own `asecppaw` package (`~/ase-cp-paw`, GPL-3.0) does the
same job in matplotlib, and it was read as the specification for *what shape* each plot is —
particularly `dos_plot.py`, whose stacking and shading conventions are recorded in
[§ The DOS convention](#the-dos-convention) below.

## Status legend

`SHOWS` Atomscope draws this today · `PARTIAL` the data is there and reaches a chart, but the
figure's own presentation is not yet drawn · `MISSING` needs capability we do not have ·
`n/a` a hand sketch or a figure reproduced from another book, not an output of the code

## The 35 figures

| Fig | Ch | What it shows | How the course draws it | Atomscope surface | Status |
|-----|----|---------------|-------------------------|-------------------|--------|
| 2.1 | 2.6 | the non-primitive fcc cell of the water example, with its basis vectors | a viewer screenshot | viewport with the unit-cell box; crystal view | SHOWS |
| 3.1 | 3.3 | total DOS with the oxygen-p and other projections stacked underneath it | `paw_dos.x` → xmgrace | Analysis ▸ DOS, stacked and filled under the total | SHOWS |
| 4.1 | 4.1 | proton tunnelling in malonaldehyde — the reaction, as a scheme | drawn by hand | — | n/a |
| 4.2 | 4.3 | total DOS plus a stack of the hydrogen, carbon and oxygen projections | `paw_dos.x` → xmgrace | Analysis ▸ DOS, stacked per element | SHOWS |
| 4.3 | 4.3 | which oxygen p-orbitals enter the σ-bond, as a sketch | drawn by hand | — | n/a |
| 4.4 | 4.3 | which carbon p-orbitals enter the σ-bond, as a sketch | drawn by hand | — | n/a |
| 4.5 | 4.3 | the p<sub>z</sub> orbital, as a sketch | drawn by hand | — | n/a |
| 4.6 | 4.4 | the same DOS stack for the relaxed (asymmetric) geometry | `paw_dos.x` → xmgrace | Analysis ▸ DOS, stacked per element | SHOWS |
| 4.7 | 4.5 | the equilibrium structure as ball-and-stick, and a second style | POV-Ray | viewport (ball-and-stick, and the other display styles) + POV-Ray scene export | SHOWS |
| 4.8 | 4.6 | the twelfth molecular wave function as an isosurface on the molecule | `paw_wave.x` → POV-Ray | Analysis ▸ Orbitals → isosurface in the viewport; POV-Ray export includes the mesh | SHOWS |
| 4.9 | 4.7 | first frame of a video of the vibrating molecule | POV-Ray, frame by frame | trajectory player animates it in the app | PARTIAL |
| 5.1 | 5.5 | the friction the atom thermostat applies, against time | `!>` rows → xmgrace | Analysis ▸ Convergence, `atom friction` series | SHOWS |
| 5.2 | 5.5 | the friction the wave thermostat applies to the wave functions | `!>` rows → xmgrace | Analysis ▸ Convergence, `wave-function friction` series | SHOWS |
| 5.3 | 5.6 | temperature against time, with a running average over it | `!>` rows → xmgrace | Analysis ▸ Convergence, `temperature` series | PARTIAL |
| 5.4 | 5.7 | temperature of the carbon atoms alone vs the hydrogens, averaged over 0.1 ps | `paw_tra.x` per atom group | — | MISSING |
| 5.5 | 5.7 | the same, averaged over 1 ps, so the equipartition is visible | `paw_tra.x` per atom group | — | MISSING |
| 5.6 | 5.8 | three bond distances against time, showing the proton transfer | `paw_tra.x` → xmgrace | trajectory is stored and playable; no distance-vs-time chart | MISSING |
| 5.7 | 5.10 | first frame of a video of the trajectory, with text overlaid | POV-Ray, frame by frame | trajectory player animates it in the app | PARTIAL |
| 6.1 | 6.2 | DOS of silicon: total as an outline, the projections as filled regions | `paw_dos.x` → xmgrace | Analysis ▸ DOS, stacked under the total's outline | SHOWS |
| 6.2 | 6.3.3 | the same DOS computed with "empty atoms" filling the interstitial volume | extra sites in the `.strc` | — | MISSING |
| 6.3 | 6.3.4 | the fcc Brillouin zone and its high-symmetry points | reproduced from a textbook | — (no Brillouin-zone view; the k-path *labels* are on the band chart) | n/a |
| 6.4 | 6.3.4 | band structure of silicon, occupied bands drawn differently from empty ones | `paw_bands.x` → xmgrace | Analysis ▸ Bands — curves draw, all one colour | PARTIAL |
| 6.5 | 6.3.5 | the sawtooth: total energy against volume at a fixed plane-wave cutoff | a table of runs → xmgrace | Sweeps panel, energy against the swept parameter | SHOWS |
| 6.6 | 6.3.6 | energy against scaled lattice constant, with a cubic polynomial through it | `xmgrace` fit | Sweeps panel draws the points; no fitted curve | PARTIAL |
| 6.7 | 6.3.7 | the same points with a Birch-Murnaghan equation of state fitted | `paw_murnaghan.x` | Sweeps panel draws the points; no fitted curve, no bulk modulus | PARTIAL |
| 6.8 | 6.4 | DOS of aluminium against the free-electron-gas √E curve | `paw_dos.x` + an analytic curve | Analysis ▸ DOS, stacked — without the analytic √E curve beside it | PARTIAL |
| 6.9 | 6.4 | band structure of aluminium, full bands separated from partly filled ones | `paw_bands.x` → xmgrace | Analysis ▸ Bands — curves draw, all one colour | PARTIAL |
| 7.1 | 7.1 | spin-resolved DOS of α-iron, majority against minority | `paw_dos.x` → xmgrace | Analysis ▸ DOS, stacked per spin, mirrored about zero | SHOWS |
| 7.2 | 7.2 | the rock-salt cell inside the fcc cell, and the magnetic cell | a viewer screenshot | viewport with the unit-cell box; supercell builder | SHOWS |
| 7.3 | 7.2 | DOS of NiO, total and angular-momentum projected, per spin | `paw_dos.x` → xmgrace | Analysis ▸ DOS, stacked per angular momentum, per spin | SHOWS |
| 8.1 | 8.1 | two panels: total energy above, plane-wave counts below | two xmgrace graphs | Sweeps panel, `Convergence` over `Basis-set size` | SHOWS |
| 8.2 | 8.2 | convergence of iron's total energy with the plane-wave cutoff | a table of runs → xmgrace | Sweeps panel, with the converged-from marker | SHOWS |
| 8.3 | 8.3 | convergence of aluminium's energy with the density-cutoff parameter R | a table of runs → xmgrace | Sweeps panel | SHOWS |
| 8.4 | 8.4 | DOS of aluminium at several k-point densities, overlaid in one graph | several `paw_dos.x` runs → one xmgrace graph | one DOS at a time; no overlay across calculations | MISSING |
| 8.5 | 8.5 | total energy of water against the lattice parameter of its fcc cell | a table of runs → xmgrace | Sweeps panel, with the converged-from marker | SHOWS |

Totals, derived with
`awk -F'|' 'NR>2 && NF>=7 {gsub(/ /,"",$7); print $7}' docs/course/figures.md | sort | uniq -c`:
**17 SHOWS · 8 PARTIAL · 5 MISSING · 5 n/a.**

## What the gaps actually are

Grouped by the work they need rather than by chapter, because one change closes several rows.

| Gap | Figures | Size |
|-----|---------|------|
| band curves coloured by occupation | 6.4, 6.9 | needs the Fermi level per band point; `paw_bands.x` gives eigenvalues only |
| a fitted curve through sweep points (cubic, then Birch-Murnaghan) | 6.6, 6.7 | numpy on `SweepResult`; the course's own tool is `paw_murnaghan.x` |
| running average over a time series | 5.3 | a chart option |
| a distance (or angle) against time, from a stored trajectory | 5.6 | pure function of the trajectory plus two atom indices |
| DOS overlay across several calculations | 8.4 | a second calculation selector on the Analysis panel |
| per-atom-group temperature | 5.4, 5.5 | needs `paw_tra.x` mode extraction, which we do not drive yet |
| empty atoms | 6.2 | a `.strc` feature: sites with no nucleus |
| a frame sequence rendered out as a video | 4.9, 5.7 | the POV-Ray export renders one scene; a video needs the frame loop and an encoder |
| an analytic reference curve on a chart (free-electron √E) | 6.8 | `asecppaw`'s `makeFunction` does this; a chart option for us |
| a Brillouin-zone view | 6.3 | not needed to reproduce the course, but it is the one 3D view we have no equivalent of |

## The DOS convention

Read out of `asecppaw/dos_plot.py`, because seven figures have this shape and getting it wrong
would be invisible in a unit test but obvious in the picture:

- **Stacked, and filled to the previous series' curve** — not to zero. `makeStack` carries a
  running cumulative baseline and each series is filled between the old baseline and the new one
  (`fill_between(x, y1, y)`), so the total DOS is the outline and the projections partition the
  area under it.
- **Shaded by where the state sits, not by its occupation number.** The split is on energy
  against the Fermi level (`dos_plot.py:101`): the part of the curve left of E<sub>F</sub> is
  filled at full opacity, the part right of it in the *same* colour at **half alpha**. The
  boundary point is duplicated into the unoccupied list (`dos_plot.py:87`) so the two regions
  meet without a gap. Our `DosSeries.occupied_dos` is a smooth occupation weighting and would
  draw a soft boundary — the course's is a hard cut at E<sub>F</sub>.
- **Colour comes from the element**, from the same element-colour table the viewer uses, with a
  hatch pattern distinguishing repeats of one element; an angular-momentum projection is coloured
  by the orbital instead.
- **Only weights that partition the total may be stacked**, and the `.dcntl` says which those
  are: the `TYPE` on each `!ATOM`. `ALL` is a whole atom or element, `S`/`P`/`D`/`F` one of its
  channels, and an `!ORB` weight is a hand-built orbital that overlaps whatever else was asked
  for. `DosSeries.group` and `.channel` carry that classification, so the chart never guesses
  from a series name — water's own DOS has all five shapes in one file, including an `o-sp3`
  orbital weight that a name-based rule would have stacked on top of `O_1_p`.
- **We stack the finest partition that was requested**, where `asecppaw` lets the user compose
  the stack by hand: asking for l channels gives the l-resolved stack of Fig. 3.1, leaving them
  off gives the element stack of Fig. 4.2.
- **The stack reaches the total only as far as the requested channels account for it** — only
  `s` is emitted for hydrogen, for instance. Drawing the total as an outline rather than as the
  top of the stack is what makes that shortfall visible instead of hiding it.
- **Spin down is a second, independently accumulated stack**, drawn negative so the two channels
  mirror about zero — which is what we already store (`DosSeries` keeps the code's sign).

## What was checked, and how

- **The band chart draws.** The user guide had been saying it "does not currently draw the band
  curves". That is stale: `src/model/bands.render.test.tsx` renders silicon's real ten bands —
  200 k-points along the fcc path, as `paw_bands.x` wrote them for the ch. 6.3 exercise — through
  the chart the Bands section uses, and gets ten polylines with 200 valid vertices each. The
  fixture is that run's actual output.
- **Band results now survive reopening a project.** They were fetched only when the button was
  pressed, so an example project showed *No band structure computed yet* over a finished run.
- **The friction series exist now.** `friction_psi` and `friction_atoms` were parsed off the
  `!>` rows all along and thrown away; Figs 5.1 and 5.2 are exactly those two traces. Measured on
  the course's own runs: water-relax has both (atom friction up to 0.01), while the
  wave-function-only runs have no atom friction at all — so it is emitted only when non-zero.
- **The charts have a legend now.** `.chart-legend` had been styled and never wired, and
  `LineChart` drew a series' `label` nowhere. The course's DOS captions identify each region
  by colour, so a stack of unnamed coloured bands would not have been that figure. Series
  marked `quiet` (the twenty band curves) stay out of it, which is what the flag was for.
- **Analysis tools need the health check to have run.** `paw_bands.x` failed with
  `exit code 2` and a Fortran format error until the course runner was made to call
  `health_check()`. The installed CP-PAW tools need an older libgfortran than the system one and
  the path to it is *discovered* by that check, so any script driving the plugin directly gets an
  empty environment and every tool dies. `env -i .../paw_bands.x case.bcntl` reproduces it
  exactly. Documented in `backends/cppaw/settings.py`; the API server has always run the check at
  startup, which is why this never showed up in the application.
