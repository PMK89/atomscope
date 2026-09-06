Wavefunction fixtures copied from the Avogadro 1 test corpus (`avogadro-master/testfiles/`,
upstream <https://github.com/cryos/avogadro>).

Two notices apply and both are kept: Avogadro 1 is **GPL-2.0-or-later**, and the `testfiles/`
directory carries its own `COPYING`, a **BSD-3-Clause** notice (© 2006 Jerome Pansanel), whose
first condition asks that redistributions retain it -- so it sits here as
`COPYING.avogadro-testfiles`. Upstream does not record which of the two covers which file;
Atomscope is GPL-3.0-or-later, which is compatible with either. (An earlier version of this
README named only the GPL.)

- `co.fchk` — CO, Gaussian formatted checkpoint, s/p shells only
- `d-only.fchk` — pure (5D) d shells, for the solid-harmonic transformation
- `benzene.fchk.gz` — benzene B3LYP/3-21G (gzipped here to keep the repository small)
- `benzene.molden.gz` — the same molecule as a Molden file with Cartesian (6D) d shells
- `d-only.gamess.gz` — methane in an all-d basis, a GAMESS-US log: the Cartesian d ordering
- `f-only.gamess.gz` — the same molecule in an all-f basis: the Cartesian f ordering, which is
  where GAMESS and Gaussian disagree
- `caffeine_orca.molden.gz` — `testfiles/koffein_orca.molden` (written by `orca_2mkl`),
  trimmed to the first 60 orbitals of 246 and gzipped: 1.5 MB otherwise, and the occupied
  set ends at 51. It is here because ORCA writes contraction coefficients for unnormalized
  primitives, against Molden's specification, and this is the file that catches it
- `caffeine_orca.out.gz` — `testfiles/koffein_orca.out`, the ORCA output of the very same job,
  cut down from 2.8 MB: the banner, both the first optimization step and the converged one
  (geometry, basis, and the settings lines that carry the charge, the electron count and the
  basis dimension), the first step's orbitals trimmed to 6 and the converged orbitals to the
  same 60 the Molden fixture keeps. Keeping both steps is deliberate -- a reader that took the
  first would get the unconverged geometry -- and keeping the same 60 orbitals lets the two
  files be read against each other function by function
- `methane.mpo` — `testfiles/methane.mpo`, gzipped and otherwise untouched: RHF/6-31G methane
  from Molpro with `gprint,basis` and `gprint,orbitals`, 17 basis functions. s and p only and
  segmented, so it checks neither Molpro's d5 component order nor a generally contracted basis
  -- the reader refuses both rather than guessing. Despite the name it is Molpro, not MOPAC

The two GAMESS logs are 16 single-primitive shells and 5 three-primitive contractions (one per
atom), so they exercise the shell ordering thoroughly and the contraction convention only in
those five -- though the lowest orbital, which is dominated by them, still comes back normalized
to 1e-5. A log with a fully contracted standard basis (STO-3G, say) is not in the corpus and has
not been read.
