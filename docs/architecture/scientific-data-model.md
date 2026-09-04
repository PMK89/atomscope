# Scientific data model

All types live in `atomscope.model` as pydantic v2 models. They are JSON-serializable with a
deterministic field order, so they double as the project file format and the API contract.

## Units

Internal storage follows ASE: length in Å, energy in eV, forces in eV/Å, time in fs, charge in e,
magnetic moments in μB, frequencies in cm⁻¹. Every quantity that could be ambiguous carries an
explicit `unit` tag (`Quantity`, `AtomicScalarProperty`, `AtomicVectorProperty`, grid metadata).
`atomscope.units` provides conversions; CP-PAW's Hartree/Bohr appear only inside the CP-PAW adapter.
Constants come from `ase.units` so ASE and Atomscope never disagree.

## Core types

| Type | Fields (abridged) | Notes |
|---|---|---|
| `Atom` | `element` (symbol), `position` (Å), `formal_charge`, `label`, `uid` | `uid` is stable across edits so selections and undo survive re-indexing |
| `Bond` | `a`, `b` (atom indices), `order` (1..3), `aromatic` | indices refer to `Structure.atoms` order |
| `Cell` | `vectors` 3x3 (Å), `pbc` (3 bools) | absent for isolated molecules |
| `Structure` | `atoms`, `bonds`, `cell`, `charge`, `multiplicity`, `atomic_scalars`, `atomic_vectors`, `properties`, `constraints`, `residues`, `provenance` | the central editable object |
| `AtomicScalarProperty` / `AtomicVectorProperty` | `values`, `unit`, `description` | length must equal atom count; e.g. partial charges, forces, magnetic moments |
| `Quantity` | `value`, `unit` | molecular scalars: total energy, dipole magnitude ... |
| `Constraint` | discriminated union: `FixAtoms`, `FixBondLength`, `FixCartesian` | mirrors ASE constraints, JSON-safe |
| `Residue` | `name`, `number`, `chain`, `atom_indices` | biomolecules |
| `VolumetricGrid` | `origin`, `axes` (3 step vectors), `shape`, `unit`, `kind`, `orbital` metadata, `data_ref` | values are stored as a binary sidecar (float32/float64) referenced by `data_ref`; small grids may be inline |
| `OrbitalInfo` | `index`, `energy` (eV), `occupation`, `spin`, `kpoint`, `label`, `homo_lumo` | for orbital selection UI |
| `Trajectory` | `frames` (positions + optional cell per frame), `per_frame` properties (energy, temperature, time, forces) | shares `Structure` topology; large trajectories stream by frame |
| `VibrationalMode` | `frequency` (cm⁻¹), `displacements`, `ir_intensity`, `raman_activity`, `symmetry` | |
| `Provenance` | `source`, `created_at`, `software`, `parents`, `notes` | attached to structures, datasets and calculations |

## Invariants (enforced by validators and tested)

- Bond indices are within range, `a != b`, no duplicate bonds.
- Atomic property lengths equal the number of atoms.
- Cell vectors are finite; `pbc` requires a cell.
- Element symbols are valid (validated against ASE's periodic table).

## ASE mapping

`atomscope.ase_bridge.convert.to_atoms(structure)` / `from_atoms(atoms, template=None)` round-trip
positions, symbols, cell, pbc, constraints (FixAtoms, FixCartesian, FixBondLengths), initial
charges/magmoms, and stash bonds, formal charges, labels, residues and uids in `atoms.info`
under the key `atomscope`, so ASE tools that copy `info` keep them.
