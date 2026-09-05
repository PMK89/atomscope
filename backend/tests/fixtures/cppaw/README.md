# CP-PAW golden fixtures

Produced on this workstation with the installed CP-PAW (dev version, hash aa467ef, built
2025-05-07, `paw_fast.x`) during Phase 0 smoke tests (2026-09-04), from inputs derived from the
distribution example `src/Docs/Examples/si2.*` and the water example of the historical
`asecppaw` package. They are the reference for parser tests; regenerate only deliberately.

- `si2/`      static wavefunction optimization of the Si2 example (no forces printed)
- `si2_rdyn/` same with `!RDYN` enabled: ATOMLIST REPORT contains FORCE[MH/ABOHR] columns
- `h2o/`      water molecule: protocol, trajectory, pdos, structure out, total density cube (gzipped)
- `h2o_dos/`  `paw_dos.x` output for the h2o `.pdos` (generated `case.dcntl` with element/l
  projections, `DE=0.05 eV`, broadening 0.2 eV; spin-polarized so each `.dos` holds two blocks)
  plus the `case.dprot` protocol with the Fermi level
