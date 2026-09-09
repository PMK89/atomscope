"""Thermochemistry from vibrational frequencies (``ase.thermochemistry``).

Three of ASE's four models are here, which are the three that need nothing a finished
calculation does not already provide:

* **ideal gas** (`IdealGasThermo`) -- a molecule in the gas phase: translation, rotation and
  vibration, so it gives an enthalpy and a Gibbs energy at a temperature *and a pressure*.
* **harmonic** (`HarmonicThermo`) -- everything vibrational and nothing else, which is the usual
  model for an adsorbate held on a surface. Internal energy and Helmholtz energy; no pressure.
* **hindered translator / hindered rotor** (`HinderedThermo`) -- an adsorbate that can hop
  between sites and rotate over a barrier, between the harmonic limit (barriers much larger than
  kT) and the two-dimensional gas limit. Its extra parameters are the two barriers, the site
  density and the number of rotational minima.

`CrystalThermo` is **not** offered: it needs a phonon density of states, which means force
constants across a supercell, and nothing in Atomscope produces one yet. Saying so is better than
a panel that asks for a file the user has no way to make.

What ASE does not do is decide *how many* modes belong to the molecule, whether it is linear, or
what its rotational symmetry number is. The first two come from `analysis.vibrations`, which has
already separated the translations and rotations from the vibrations and recorded whether there
were five of them or six. The symmetry number cannot be guessed from a geometry -- it is a
property of the molecule's point group and the caller supplies it (2 for N2 or H2O, 6 for CH3 or
NH3, 12 for benzene, 1 when in doubt, which overestimates the entropy).

Imaginary modes reach here as **negative** cm^-1 (that is `vibrations.frequencies_cm`'s
convention) and are converted to imaginary energies before ASE sees them, because ASE tests
`np.iscomplex` and would otherwise take a negative energy as a real one and return a number that
looks fine and is not.
"""

from __future__ import annotations

import warnings
from typing import Literal

import numpy as np
from ase import Atoms, units
from ase.thermochemistry import HarmonicThermo, HinderedThermo, IdealGasThermo
from pydantic import Field

from atomscope.ase_bridge.convert import to_atoms
from atomscope.model.common import StrictModel
from atomscope.model.structure import Structure

ThermoModel = Literal["ideal-gas", "harmonic", "hindered"]
Geometry = Literal["monatomic", "linear", "nonlinear"]

#: Standard pressure, and ASE's own reference pressure (`IdealGasThermo.referencepressure`).
STANDARD_PRESSURE_PA = 1.0e5
ROOM_TEMPERATURE_K = 298.15


class ThermoError(ValueError):
    """Bad input: no modes, an imaginary mode that was not allowed, a missing parameter."""


class ThermoPoint(StrictModel):
    """The state functions at one temperature (and pressure, where the model has one)."""

    temperature_k: float
    pressure_pa: float | None = Field(
        default=None, description="only the ideal-gas model depends on it"
    )
    internal_energy_ev: float | None = Field(
        default=None, description="U(T) - E_pot for the harmonic models"
    )
    enthalpy_ev: float | None = Field(default=None, description="H(T) for the ideal-gas model")
    entropy_ev_per_k: float
    free_energy_ev: float = Field(description="Gibbs for the ideal gas, Helmholtz otherwise")
    ts_ev: float = Field(description="T*S, the entropic part of the free energy at this point")


class ThermoTable(StrictModel):
    """A model, the modes it used, and the state functions over a temperature range."""

    model: ThermoModel
    free_energy_kind: Literal["gibbs", "helmholtz"]
    geometry: Geometry | None = None
    symmetry_number: int | None = None
    spin: float | None = None
    potential_energy_ev: float
    zpe_ev: float = Field(description="zero-point vibrational energy")
    n_modes: int = Field(description="modes ASE kept after trimming to the geometry")
    n_imaginary: int = Field(default=0, description="imaginary modes dropped")
    points: list[ThermoPoint]

    @property
    def at_room_temperature(self) -> ThermoPoint | None:
        for p in self.points:
            if abs(p.temperature_k - ROOM_TEMPERATURE_K) < 0.5:
                return p
        return None


class HinderedParameters(StrictModel):
    """What `HinderedThermo` needs beyond the frequencies (ASE's own names in the docstrings)."""

    trans_barrier_energy_ev: float = Field(
        ge=0.0, description="barrier for diffusion between neighbouring sites"
    )
    rot_barrier_energy_ev: float = Field(ge=0.0, description="barrier for rotation on the site")
    site_density_cm2: float = Field(
        gt=0.0, description="adsorption sites per cm^2 of surface (ASE's `sitedensity`)"
    )
    rotational_minima: int = Field(ge=1, description="equivalent minima in a full rotation")
    symmetry_number: int = Field(default=1, ge=1)
    mass_amu: float | None = Field(
        default=None, description="adsorbate mass; taken from the structure when omitted"
    )
    inertia_amu_a2: float | None = Field(
        default=None, description="moment of inertia about the surface normal"
    )


def energies_ev(frequencies_cm: list[float] | np.ndarray) -> list[complex]:
    """Frequencies in cm^-1 to vibrational energies in eV, negative ones becoming imaginary.

    `vibrations.frequencies_cm` reports an imaginary mode as a negative wavenumber. ASE detects
    an imaginary mode with `np.iscomplex`, so the sign has to be moved into the imaginary part
    here or a saddle point would silently produce a plausible-looking free energy.
    """
    out: list[complex] = []
    for f in np.asarray(frequencies_cm, dtype=float).tolist():
        magnitude = abs(f) * units.invcm
        out.append(complex(0.0, magnitude) if f < 0 else complex(magnitude, 0.0))
    return out


#: Below this ratio of the smallest to the largest principal moment a molecule counts as linear.
LINEAR_TOLERANCE = 1e-3


def detect_geometry(atoms: Atoms) -> Geometry:
    """Monatomic, linear or nonlinear from the principal moments of inertia.

    ASE does not work this out -- `IdealGasThermo` takes the word `linear` or `nonlinear` and
    trusts it, because the answer decides whether 3N-5 or 3N-6 modes are vibrations. A linear
    molecule has one vanishing principal moment, which is what is tested here; a caller that
    knows better (the mode analysis counts its own translations and rotations) passes `geometry`
    and this is not used.
    """
    if len(atoms) < 2:
        return "monatomic"
    moments = np.sort(np.abs(atoms.get_moments_of_inertia()))
    if moments[-1] <= 0:
        return "monatomic"
    return "linear" if moments[0] / moments[-1] < LINEAR_TOLERANCE else "nonlinear"


def _temperatures(temperatures_k: list[float]) -> list[float]:
    if not temperatures_k:
        msg = "give at least one temperature"
        raise ThermoError(msg)
    if any(t <= 0 for t in temperatures_k):
        msg = "temperatures must be above absolute zero"
        raise ThermoError(msg)
    return list(temperatures_k)


def thermo_table(
    model: ThermoModel,
    frequencies_cm: list[float],
    temperatures_k: list[float],
    *,
    structure: Structure | None = None,
    potential_energy_ev: float = 0.0,
    pressure_pa: float = STANDARD_PRESSURE_PA,
    geometry: Geometry | None = None,
    symmetry_number: int = 1,
    spin: float = 0.0,
    hindered: HinderedParameters | None = None,
    ignore_imaginary: bool = False,
) -> ThermoTable:
    """The state functions of ``model`` over ``temperatures_k``.

    ``frequencies_cm`` are the vibrational modes only -- `analysis.vibrations` has already put the
    translations and rotations aside.

    ``structure`` is **required by the ideal-gas model**, which needs the moments of inertia and
    the mass for the rotational and translational entropy; it also decides how many of the given
    modes are vibrations of a molecule of that shape. For the hindered model it is the
    *adsorbate*, not the slab, and it supplies the mass and the moment of inertia unless those
    are given explicitly. The harmonic model needs no structure at all.
    """
    temperatures = _temperatures(temperatures_k)
    if not frequencies_cm:
        msg = "there are no vibrational modes to work from"
        raise ThermoError(msg)
    vib = energies_ev(frequencies_cm)
    n_imaginary_in = sum(1 for f in frequencies_cm if f < 0)
    if n_imaginary_in and not ignore_imaginary:
        msg = (
            f"{n_imaginary_in} imaginary mode(s) present: this is not a minimum. "
            "Relax it further, or ask for them to be ignored."
        )
        raise ThermoError(msg)

    atoms = to_atoms(structure) if structure is not None else None
    if model == "ideal-gas" and atoms is None:
        msg = "the ideal-gas model needs the molecule itself, for its mass and moments of inertia"
        raise ThermoError(msg)
    shape = geometry or (detect_geometry(atoms) if atoms is not None else "nonlinear")
    try:
        with warnings.catch_warnings():
            # ASE warns for each dropped imaginary mode; the count is reported in the table
            warnings.simplefilter("ignore", UserWarning)
            table = _build(
                model,
                vib,
                temperatures,
                potential_energy_ev=potential_energy_ev,
                pressure_pa=pressure_pa,
                atoms=atoms,
                shape=shape,
                symmetry_number=symmetry_number,
                spin=spin,
                hindered=hindered,
                ignore_imaginary=ignore_imaginary,
            )
    except ThermoError:
        raise
    except (ValueError, RuntimeError, ZeroDivisionError, TypeError) as exc:
        raise ThermoError(str(exc)) from exc
    return table


def _build(
    model: ThermoModel,
    vib: list[complex],
    temperatures: list[float],
    *,
    potential_energy_ev: float,
    pressure_pa: float,
    atoms: Atoms | None,
    shape: Geometry,
    symmetry_number: int,
    spin: float,
    hindered: HinderedParameters | None,
    ignore_imaginary: bool,
) -> ThermoTable:
    points: list[ThermoPoint] = []
    if model == "ideal-gas":
        gas = IdealGasThermo(
            vib_energies=vib,
            geometry=shape,
            potentialenergy=potential_energy_ev,
            atoms=atoms,
            symmetrynumber=symmetry_number,
            spin=spin,
            ignore_imag_modes=ignore_imaginary,
        )
        for t in temperatures:
            entropy = float(gas.get_entropy(t, pressure_pa, verbose=False))
            enthalpy = float(gas.get_enthalpy(t, verbose=False))
            points.append(
                ThermoPoint(
                    temperature_k=t,
                    pressure_pa=pressure_pa,
                    enthalpy_ev=enthalpy,
                    entropy_ev_per_k=entropy,
                    free_energy_ev=float(gas.get_gibbs_energy(t, pressure_pa, verbose=False)),
                    ts_ev=t * entropy,
                )
            )
        return ThermoTable(
            model=model,
            free_energy_kind="gibbs",
            geometry=shape,
            symmetry_number=symmetry_number,
            spin=spin,
            potential_energy_ev=potential_energy_ev,
            zpe_ev=float(gas.get_ZPE_correction()),
            n_modes=len(gas.vib_energies),
            n_imaginary=int(gas.n_imag),
            points=points,
        )

    thermo: HarmonicThermo | HinderedThermo
    if model == "harmonic":
        thermo = HarmonicThermo(
            vib_energies=vib,
            potentialenergy=potential_energy_ev,
            ignore_imag_modes=ignore_imaginary,
        )
    else:
        if hindered is None:
            msg = "the hindered model needs its barriers, site density and rotational minima"
            raise ThermoError(msg)
        if atoms is None and (hindered.mass_amu is None or hindered.inertia_amu_a2 is None):
            msg = (
                "the hindered model needs the adsorbate structure, or its mass and moment of "
                "inertia given explicitly"
            )
            raise ThermoError(msg)
        thermo = HinderedThermo(
            vib_energies=vib,
            trans_barrier_energy=hindered.trans_barrier_energy_ev,
            rot_barrier_energy=hindered.rot_barrier_energy_ev,
            sitedensity=hindered.site_density_cm2,
            rotationalminima=hindered.rotational_minima,
            potentialenergy=potential_energy_ev,
            atoms=atoms,
            mass=hindered.mass_amu,
            inertia=hindered.inertia_amu_a2,
            symmetrynumber=hindered.symmetry_number,
            ignore_imag_modes=ignore_imaginary,
        )
    for t in temperatures:
        entropy = float(thermo.get_entropy(t, verbose=False))
        points.append(
            ThermoPoint(
                temperature_k=t,
                internal_energy_ev=float(thermo.get_internal_energy(t, verbose=False)),
                entropy_ev_per_k=entropy,
                free_energy_ev=float(thermo.get_helmholtz_energy(t, verbose=False)),
                ts_ev=t * entropy,
            )
        )
    return ThermoTable(
        model=model,
        free_energy_kind="helmholtz",
        potential_energy_ev=potential_energy_ev,
        zpe_ev=float(thermo.get_ZPE_correction()),
        n_modes=len(thermo.vib_energies),
        n_imaginary=int(thermo.n_imag),
        points=points,
    )
