"""Vibrational analysis and spectra on posted data.

Like ``/api/chem``, these endpoints are pure functions of the request body: nothing is stored,
so the frontend can compute modes for whatever structure the user is editing without first
saving it into a project.

**Why synchronous and not a JobManager job.** The JobManager runs a backend plugin inside a
calculation directory of the open project (``atomscope.calculations.service``); a posted
structure has no calculation and no directory, so the post-processing job pattern used for
CP-PAW DOS/bands does not fit. A Hessian costs ``6N`` force evaluations, which for the force
fields offered here (Open Babel, ASE built-ins) is sub-millisecond per evaluation, so the
request stays synchronous behind an explicit, measured atom limit (:data:`MAX_ATOMS`).
Expensive calculators such as CP-PAW must go through a real calculation instead.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import Field

from atomscope.analysis import spectra as spectra_mod
from atomscope.analysis.broadening import auto_grid, broaden, to_transmittance
from atomscope.analysis.vibrations import VibrationError, compute_modes, make_engine
from atomscope.chem import forcefield
from atomscope.model import (
    ElectronicTransition,
    LineShape,
    NmrShielding,
    Spectrum,
    SpectrumAxis,
    SpectrumKind,
    SpectrumPeak,
    Structure,
    VibrationalSpectrum,
    new_uid,
)
from atomscope.model.common import StrictModel
from atomscope.parsers.gaussian_log import parse_gaussian_log
from atomscope.parsers.orca_out import parse_orca_output
from atomscope.parsers.qchem_out import parse_qchem_output
from atomscope.parsers.spectra_common import SpectraParseError
from atomscope.parsers.spectrum_files import read_jcamp_dx, read_xy_spectrum

router = APIRouter(prefix="/api/analysis", tags=["analysis"])
io_router = APIRouter(prefix="/api/io", tags=["analysis"])

#: A Hessian needs 6N force evaluations. Measured with MMFF94 on this machine: 0.3 s at 24
#: atoms (caffeine), 0.6 s at 56, 4.1 s at 122; the limit keeps the synchronous request
#: comfortably under a handful of seconds.
MAX_ATOMS = 120


class VibrationsRequest(StrictModel):
    structure: Structure
    calculator: str = Field(
        default="openbabel", description="openbabel | emt | lj | morse (ASE built-ins)"
    )
    force_field: str = Field(default="MMFF94", description="Open Babel force field")
    delta: float = Field(default=0.01, gt=0, le=0.2, description="displacement in Å")
    optimize_first: bool = Field(
        default=True,
        description="minimise with the same force field first; a Hessian at a non-stationary "
        "geometry mixes real modes into the translations and rotations",
    )
    charge_model: str = Field(
        default="gasteiger", description="Open Babel charge model for the approximate dipole"
    )


class VibrationsResponse(StrictModel):
    vibrations: VibrationalSpectrum
    structure: Structure = Field(description="the geometry the modes belong to")
    ir: Spectrum


class SpectrumRequest(StrictModel):
    peaks: list[SpectrumPeak]
    kind: SpectrumKind = "other"
    name: str = "spectrum"
    x: SpectrumAxis
    y: SpectrumAxis
    width: float = Field(default=30.0, gt=0, description="FWHM in x units")
    shape: LineShape = "gaussian"
    points: int = Field(default=1000, ge=16, le=20000)
    transmittance: bool = Field(default=False, description="convert absorbance to transmittance")
    transmittance_scale: float = Field(default=0.01, gt=0)


class IrSpectrumRequest(StrictModel):
    vibrations: VibrationalSpectrum
    width: float = Field(default=30.0, gt=0)
    shape: LineShape = "gaussian"
    scale_factor: float = Field(default=1.0, gt=0)
    transmittance: bool = False
    raman: bool = Field(default=False, description="plot Raman activities instead of IR")


class NmrSpectrumRequest(StrictModel):
    shieldings: list[NmrShielding]
    element: str = Field(description="nucleus to plot, e.g. 'H' or 'C'")
    reference: float = Field(
        default=0.0,
        description="shielding of the standard (TMS) from the same calculation; with 0 the plot "
        "shows negated absolute shieldings, as Avogadro 1 does until a reference is given",
    )
    width: float = Field(default=0.05, gt=0, description="FWHM in ppm")
    shape: LineShape = "lorentzian"
    points: int = Field(default=1000, ge=16, le=20000)


class ElectronicSpectrumRequest(StrictModel):
    transitions: list[ElectronicTransition]
    circular_dichroism: bool = Field(
        default=False, description="plot signed rotatory strengths instead of absorption"
    )
    width: float = Field(default=20.0, gt=0, description="FWHM in nm")
    shape: LineShape = "gaussian"
    points: int = Field(default=1000, ge=16, le=20000)


class ImportSpectrumRequest(StrictModel):
    path: Path
    kind: SpectrumKind = "experimental"


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


def _make_calculator(body: VibrationsRequest) -> object:
    from atomscope.backends.ase_builtin.runner import make_calculator  # noqa: PLC0415

    if body.calculator == "openbabel":
        from atomscope.ase_bridge.openbabel_calculator import (  # noqa: PLC0415
            OpenBabelCalculator,
        )

        return OpenBabelCalculator(force_field=body.force_field)
    if body.calculator in ("emt", "lj", "morse"):
        defaults = {"lj_epsilon": 0.01, "lj_sigma": 3.0, "lj_rc": 10.0}
        return make_calculator({"calculator": body.calculator, **defaults}, Path("."))
    msg = f"unknown calculator {body.calculator!r}"
    raise ValueError(msg)


@router.post("/vibrations", response_model=VibrationsResponse)
def vibrations(body: VibrationsRequest) -> VibrationsResponse:
    """Normal modes by finite differences, plus the broadened IR spectrum."""
    if body.structure.n_atoms > MAX_ATOMS:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"{body.structure.n_atoms} atoms exceeds the synchronous limit of {MAX_ATOMS}; "
            "run a frequency calculation through a backend instead",
        )
    structure = body.structure
    try:
        if body.optimize_first and body.calculator == "openbabel":
            structure = forcefield.optimize(
                structure,
                body.force_field,
                algorithm="conjugate_gradients",
                max_steps=2000,
                convergence=1e-10,
            ).structure
        dipole = "partial_charges" if body.calculator == "openbabel" else "calculator"
        method = (
            f"{body.force_field} (Open Babel)"
            if body.calculator == "openbabel"
            else f"ASE {body.calculator}"
        )
        if body.calculator == "openbabel":
            method += "; IR intensities from point-charge dipole derivatives (approximate)"
        engine = make_engine(
            structure,
            _make_calculator(body),
            dipole=dipole,  # type: ignore[arg-type]
            charge_model=body.charge_model,
        )
        result = compute_modes(structure, engine, delta=body.delta, method=method)
    except (VibrationError, ValueError) as exc:
        raise _bad(exc) from exc
    except NotImplementedError as exc:  # e.g. EMT has no parameters for this element
        raise _bad(exc) from exc
    return VibrationsResponse(
        vibrations=result,
        structure=structure,
        ir=spectra_mod.ir_spectrum(result),
    )


@router.post("/vibrations/spectrum", response_model=Spectrum)
def vibrational_spectrum(body: IrSpectrumRequest) -> Spectrum:
    """Re-broaden an existing set of modes as an IR or Raman spectrum."""
    if body.raman:
        return spectra_mod.raman_spectrum(
            body.vibrations,
            width=body.width,
            shape=body.shape,
            scale_factor=body.scale_factor,
        )
    return spectra_mod.ir_spectrum(
        body.vibrations,
        width=body.width,
        shape=body.shape,
        scale_factor=body.scale_factor,
        transmittance=body.transmittance,
    )


@router.post("/spectrum", response_model=Spectrum)
def spectrum(body: SpectrumRequest) -> Spectrum:
    """Broaden an arbitrary set of peaks into a curve on the given axes."""
    centers = np.array([p.x for p in body.peaks], dtype=float)
    intensities = np.array([p.intensity for p in body.peaks], dtype=float)
    x_values: list[float] = []
    y_values: list[float] = []
    y_axis = body.y
    if len(centers):
        grid = auto_grid(centers, body.width, points=body.points)
        curve = broaden(grid, centers, intensities, body.width, body.shape)
        if body.transmittance:
            curve = to_transmittance(curve, body.transmittance_scale)
            y_axis = SpectrumAxis(label="transmittance", unit="%")
        x_values = [float(v) for v in grid]
        y_values = [float(v) for v in curve]
    return Spectrum(
        id=new_uid(),
        kind=body.kind,
        name=body.name,
        x=body.x,
        y=y_axis,
        peaks=body.peaks,
        x_values=x_values,
        y_values=y_values,
        line_shape=body.shape,
        width=body.width,
    )


@router.post("/nmr", response_model=Spectrum)
def nmr(body: NmrSpectrumRequest) -> Spectrum:
    """Chemical-shift spectrum of one nucleus from calculated shieldings."""
    try:
        return spectra_mod.nmr_spectrum(
            body.shieldings,
            body.element,
            reference=body.reference,
            width=body.width,
            shape=body.shape,
            points=body.points,
        )
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/electronic", response_model=Spectrum)
def electronic(body: ElectronicSpectrumRequest) -> Spectrum:
    """UV-Vis absorption, or the signed CD spectrum, from calculated electronic transitions."""
    build = spectra_mod.cd_spectrum if body.circular_dichroism else spectra_mod.uvvis_spectrum
    try:
        return build(body.transitions, width=body.width, shape=body.shape, points=body.points)
    except ValueError as exc:
        raise _bad(exc) from exc


def _read_spectrum(name: str, text: str, kind: SpectrumKind) -> Spectrum:
    suffix = Path(name).suffix.lower()
    if suffix in (".jdx", ".dx", ".jcamp") or text.lstrip().startswith("##TITLE"):
        return read_jcamp_dx(text, name=name)
    return read_xy_spectrum(text, name=name, kind=kind)


@io_router.post("/import/spectrum", response_model=Spectrum)
def import_spectrum_path(body: ImportSpectrumRequest) -> Spectrum:
    """Import an experimental spectrum from a TSV/CSV or JCAMP-DX file on this machine."""
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    try:
        return _read_spectrum(body.path.name, body.path.read_text(errors="replace"), body.kind)
    except (SpectraParseError, ValueError) as exc:
        raise _bad(exc) from exc


@io_router.post("/import/spectrum/upload", response_model=Spectrum)
async def import_spectrum_upload(file: UploadFile) -> Spectrum:
    """Import an experimental spectrum from the browser file picker."""
    name = Path(file.filename or "spectrum.tsv").name
    text = (await file.read()).decode("utf-8", errors="replace")
    try:
        return _read_spectrum(name, text, "experimental")
    except (SpectraParseError, ValueError) as exc:
        raise _bad(exc) from exc


class VibrationImport(StrictModel):
    """What a quantum-chemistry output yielded: modes, NMR shieldings, transitions."""

    program: str
    structure: Structure | None = None
    vibrations: VibrationalSpectrum | None = None
    shieldings: list[NmrShielding] = Field(default_factory=list)
    transitions: list[ElectronicTransition] = Field(default_factory=list)


def _parse_vibrations(name: str, text: str) -> VibrationImport:
    parsers = {
        "gaussian": parse_gaussian_log,
        "orca": parse_orca_output,
        "qchem": parse_qchem_output,
    }
    order = ["gaussian", "orca", "qchem"]
    if "O   R   C   A" in text[:20000] or "VIBRATIONAL FREQUENCIES" in text:
        order = ["orca", "qchem", "gaussian"]
    elif "Q-Chem" in text[:20000] or "qchem" in name.lower() or name.endswith(".qcout"):
        order = ["qchem", "gaussian", "orca"]
    errors: list[str] = []
    for key in order:
        try:
            parsed = parsers[key](text, source=name)
        except (SpectraParseError, ValueError, IndexError, KeyError) as exc:
            errors.append(f"{key}: {exc}")
            continue
        return VibrationImport(
            program=parsed.program,
            structure=parsed.structure(name),
            vibrations=parsed.vibrations,
            shieldings=parsed.shieldings,
            transitions=parsed.transitions,
        )
    raise _bad(SpectraParseError("; ".join(errors)))


@io_router.post("/import/vibrations", response_model=VibrationImport)
def import_vibrations_path(body: ImportSpectrumRequest) -> VibrationImport:
    """Read vibrational/NMR data from a Gaussian, ORCA or Q-Chem output on this machine."""
    if not body.path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{body.path} not found")
    return _parse_vibrations(body.path.name, body.path.read_text(errors="replace"))


@io_router.post("/import/vibrations/upload", response_model=VibrationImport)
async def import_vibrations_upload(file: UploadFile) -> VibrationImport:
    """Read vibrational/NMR data from a file chosen in the browser."""
    name = Path(file.filename or "output.log").name
    return _parse_vibrations(name, (await file.read()).decode("utf-8", errors="replace"))
