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

The two GAMESS logs are 16 single-primitive shells and 5 three-primitive contractions (one per
atom), so they exercise the shell ordering thoroughly and the contraction convention only in
those five -- though the lowest orbital, which is dominated by them, still comes back normalized
to 1e-5. A log with a fully contracted standard basis (STO-3G, say) is not in the corpus and has
not been read.
