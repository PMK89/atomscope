# ASE integration

- `atomscope.ase_bridge.convert`: lossless `Structure <-> ase.Atoms` (positions, cell, pbc,
  constraints FixAtoms/FixCartesian/FixBondLengths, initial charges/magmoms natively; bonds,
  formal charges, labels, uids, residues, named properties in `atoms.info["atomscope"]`).
- `atomscope.io.registry`: ASE ioformats for xyz/extxyz/cif/pdb/vasp/cube/xsf/json and QC
  inputs/outputs; RDKit for MOL/SDF/MOL2/SMILES (bond orders); Open Babel for the long tail.
- `atomscope.chem.bonds`: bond perception through `ase.neighborlist` with covalent radii.
- `atomscope.backends.ase_builtin`: EMT/Lennard-Jones/Morse calculators with BFGS relaxation and
  Langevin MD executed as a subprocess job, producing the same `ResultBundle` as CP-PAW.

Planned: an `ase.calculators` adapter that exposes a CP-PAW calculation as an ASE calculator
(energy/forces via the `forces` task) so ASE optimizers, NEB and MD can drive CP-PAW; more ASE
calculators (TIP3P, GPAW/ORCA/Espresso input generation) as plugins.
