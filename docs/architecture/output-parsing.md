# Output parsing

Parsers are pure functions in `atomscope.parsers` (generic formats) and
`atomscope.backends.<code>` (code-specific). They take a path or text and return plain
dataclasses or model objects; they never touch the project store or the network.

Rules:

- Every parser documents the format it reads in its module docstring, with the observed layout
  quoted from real files (fixtures under `backend/tests/fixtures/`).
- Missing data is represented as `None`, never as zeros. Example: CP-PAW prints atomic forces
  only when `!RDYN` is active; `AtomListReport.has_forces` is False otherwise, and the adapter
  refuses to feed such a result to an optimizer (earlier integrations silently produced zero
  forces and "converged" at step 0).
- Units are converted once, at the adapter boundary, into the model's units (eV, Å). Parsers
  return the file's native units and say so in field names (`energy_h`, `force_mh_per_bohr`).
- Golden tests compare parsed numbers against values read by hand from the fixture files with
  tolerances matching the printed precision.
- Large arrays (grids, trajectories) are returned as NumPy arrays and stored as binary sidecars
  by the service layer, not embedded in JSON.

Parsers implemented: CP-PAW deck syntax, CP-PAW protocol (`.prot`), Gaussian cube.
Planned: CP-PAW `.strc_out` (via the deck parser), `_r.tra` trajectory, `.pdos`/`.dos`, band
files, `.dx`; Molden; ORCA/Gaussian output via ASE and cclib-style readers where licensing allows.
