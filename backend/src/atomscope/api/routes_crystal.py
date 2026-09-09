"""Crystallography routes: stateless Structure -> Structure transforms, symmetry and library.

Every mutating route takes the structure in the body and returns the transformed copy; the
frontend commits the result into its undo stack.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from atomscope import crystal
from atomscope.crystal import LibraryEntry, SpacegroupSetting, SymmetryInfo
from atomscope.crystal import surfaces as surface_mod
from atomscope.crystal.cell import Cellpar, CoordinateMode
from atomscope.io.registry import FormatError
from atomscope.model import Structure
from atomscope.model.common import Mat3, StrictModel, Vec3

router = APIRouter(prefix="/api/crystal", tags=["crystal"])

Symprec = Field(default=1e-3, gt=0, description="spglib tolerance in Å")


class StructureBody(StrictModel):
    structure: Structure


class SymmetryRequest(StructureBody):
    symprec: float = Symprec


class SetCellRequest(StructureBody):
    vectors: Mat3 | None = None
    parameters: Cellpar | None = Field(default=None, description="a b c (Å) alpha beta gamma (deg)")
    mode: CoordinateMode = "cartesian"


class FractionalRequest(StructureBody):
    fractional: list[Vec3]


class TranslateRequest(StructureBody):
    vector: Vec3
    mode: CoordinateMode = "cartesian"
    wrap: bool = False
    indices: list[int] | None = None


class VolumeRequest(StructureBody):
    volume: float = Field(gt=0, description="target volume in Å^3")


class AddCellRequest(StructureBody):
    padding: float = Field(default=5.0, ge=0)


class FillRequest(SymmetryRequest):
    spacegroup: int | None = Field(default=None, ge=1, le=230)
    hall_number: int | None = Field(
        default=None,
        ge=1,
        le=530,
        description="one of the 530 settings; honoured exactly, unlike an ITA number",
    )


class SupercellRequest(StructureBody):
    repeat: tuple[int, int, int] | None = None
    matrix: Mat3 | None = None


class SlabRequest(StructureBody):
    miller: tuple[int, int, int]
    layers: int = Field(ge=1)
    vacuum: float = Field(default=10.0, ge=0)


class NamedSurfaceRequest(StrictModel):
    """One of `ase.build`'s named surface builders (`crystal.surfaces`)."""

    kind: str = Field(description="fcc111, bcc110, hcp0001, diamond100 ...")
    symbol: str
    size: tuple[int, int, int] = Field(
        description="repeats along the two surface vectors, then the number of layers"
    )
    a: float | None = Field(default=None, gt=0, description="lattice constant; ASE's default")
    c: float | None = Field(default=None, gt=0, description="second constant, hcp only")
    vacuum: float | None = Field(
        default=None, ge=0, description="added on each side; without it the cell has no c vector"
    )
    orthogonal: bool | None = Field(
        default=None, description="square surface cell, where the builder offers the choice"
    )


class AdsorbateRequest(StructureBody):
    """Put an adsorbate on a slab, on a named site or at an x-y position."""

    adsorbate: str | Structure = Field(
        description="an element symbol, one of ASE's molecule names, or a structure"
    )
    height: float = Field(gt=0, description="Å above the slab's top layer")
    site: str | None = Field(default=None, description="named site, e.g. 'fcc'")
    position: tuple[float, float] | None = Field(
        default=None, description="Cartesian x-y instead of a named site"
    )
    offset: tuple[float, float] | None = Field(
        default=None, description="shift by whole surface cells, for a second adsorbate"
    )
    mol_index: int = Field(
        default=0, ge=0, description="which atom of a molecular adsorbate sits over the site"
    )


class VacuumRequest(StructureBody):
    vacuum: float = Field(gt=0, description="Å added along the third cell vector")


class BulkRequest(StrictModel):
    symbol: str
    crystalstructure: str = Field(description="sc, fcc, bcc, hcp, diamond, zincblende, rocksalt...")
    a: float | None = None
    c: float | None = None
    cubic: bool = False
    orthorhombic: bool = False


class SpacegroupBuildRequest(StrictModel):
    symbols: list[str]
    basis: list[Vec3]
    spacegroup: int = Field(ge=1, le=230)
    cellpar: Cellpar
    name: str | None = None


class FractionalResponse(StrictModel):
    fractional: list[Vec3]


def _run[T](fn: Callable[[], T]) -> T:
    try:
        return fn()
    except (ValueError, FormatError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/symmetry", response_model=SymmetryInfo)
def symmetry(body: SymmetryRequest) -> SymmetryInfo:
    return _run(lambda: crystal.perceive_symmetry(body.structure, body.symprec))


@router.post("/cell/set", response_model=Structure)
def set_cell(body: SetCellRequest) -> Structure:
    def go() -> Structure:
        if body.vectors is not None:
            vectors = body.vectors
        elif body.parameters is not None:
            vectors = crystal.cell_from_parameters(body.parameters)
        else:
            msg = "give either vectors or parameters"
            raise ValueError(msg)
        return crystal.set_cell(body.structure, vectors, body.mode)

    return _run(go)


@router.post("/cell/add", response_model=Structure)
def add_cell(body: AddCellRequest) -> Structure:
    return _run(lambda: crystal.add_cell(body.structure, body.padding))


@router.post("/cell/remove", response_model=Structure)
def remove_cell(body: StructureBody) -> Structure:
    return crystal.remove_cell(body.structure)


@router.post("/fractional", response_model=FractionalResponse)
def fractional(body: StructureBody) -> FractionalResponse:
    return FractionalResponse(
        fractional=_run(lambda: crystal.fractional_coordinates(body.structure))
    )


@router.post("/fractional/set", response_model=Structure)
def set_fractional(body: FractionalRequest) -> Structure:
    return _run(lambda: crystal.set_fractional_coordinates(body.structure, body.fractional))


@router.post("/wrap", response_model=Structure)
def wrap(body: StructureBody) -> Structure:
    return _run(lambda: crystal.wrap_atoms(body.structure))


@router.post("/translate", response_model=Structure)
def translate(body: TranslateRequest) -> Structure:
    return _run(
        lambda: crystal.translate_atoms(
            body.structure, body.vector, body.mode, wrap=body.wrap, indices=body.indices
        )
    )


@router.post("/standard-orientation", response_model=Structure)
def standard_orientation(body: StructureBody) -> Structure:
    return _run(lambda: crystal.rotate_to_standard_orientation(body.structure))


@router.post("/scale-volume", response_model=Structure)
def scale_volume(body: VolumeRequest) -> Structure:
    return _run(lambda: crystal.scale_to_volume(body.structure, body.volume))


@router.post("/symmetrize", response_model=Structure)
def symmetrize(body: SymmetryRequest) -> Structure:
    return _run(lambda: crystal.symmetrize(body.structure, body.symprec))


@router.post("/primitive", response_model=Structure)
def primitive(body: SymmetryRequest) -> Structure:
    return _run(lambda: crystal.primitive_cell(body.structure, body.symprec))


@router.post("/primitive-standardized", response_model=Structure)
def primitive_standardized(body: SymmetryRequest) -> Structure:
    return _run(lambda: crystal.primitive_standardized(body.structure, body.symprec))


@router.post("/niggli", response_model=Structure)
def niggli(body: StructureBody) -> Structure:
    return _run(lambda: crystal.niggli_reduce(body.structure))


@router.post("/fill", response_model=Structure)
def fill(body: FillRequest) -> Structure:
    return _run(
        lambda: crystal.fill_unit_cell(
            body.structure, body.spacegroup, body.symprec, hall_number=body.hall_number
        )
    )


@router.get("/spacegroups", response_model=list[SpacegroupSetting])
def spacegroups() -> list[SpacegroupSetting]:
    """The 530 settings of the 230 space groups, in Hall order: the Set space group table."""
    return list(crystal.spacegroup_settings())


@router.post("/asymmetric-unit", response_model=Structure)
def asymmetric_unit(body: SymmetryRequest) -> Structure:
    return _run(lambda: crystal.asymmetric_unit(body.structure, body.symprec))


@router.post("/supercell", response_model=Structure)
def supercell(body: SupercellRequest) -> Structure:
    return _run(lambda: crystal.supercell(body.structure, body.repeat, body.matrix))


@router.post("/slab", response_model=Structure)
def slab(body: SlabRequest) -> Structure:
    return _run(lambda: crystal.slab(body.structure, body.miller, body.layers, body.vacuum))


@router.get("/surfaces", response_model=list[surface_mod.SurfaceKind])
def surface_kinds() -> list[surface_mod.SurfaceKind]:
    """The named surface builders, with the adsorption sites each facet has."""
    return surface_mod.kinds()


@router.get("/surfaces/adsorbates", response_model=list[str])
def adsorbate_names() -> list[str]:
    """ASE's molecule names, which an adsorbate may be given as (any element symbol also works)."""
    return list(surface_mod.MOLECULE_NAMES)


@router.post("/surfaces/build", response_model=Structure)
def build_named_surface(body: NamedSurfaceRequest) -> Structure:
    return _run(
        lambda: surface_mod.build(
            body.kind,
            body.symbol,
            body.size,
            a=body.a,
            c=body.c,
            vacuum=body.vacuum,
            orthogonal=body.orthogonal,
        )
    )


@router.post("/surfaces/sites", response_model=list[surface_mod.AdsorptionSite])
def adsorption_sites(body: StructureBody) -> list[surface_mod.AdsorptionSite]:
    """The named sites of a slab; empty for a structure that was not built as a named surface."""
    return surface_mod.sites(body.structure)


@router.post("/surfaces/adsorbate", response_model=Structure)
def add_adsorbate(body: AdsorbateRequest) -> Structure:
    return _run(
        lambda: surface_mod.adsorb(
            body.structure,
            body.adsorbate,
            body.height,
            site=body.site,
            position=body.position,
            offset=body.offset,
            mol_index=body.mol_index,
        )
    )


@router.post("/surfaces/vacuum", response_model=Structure)
def add_surface_vacuum(body: VacuumRequest) -> Structure:
    return _run(lambda: surface_mod.with_vacuum(body.structure, body.vacuum))


@router.post("/bulk", response_model=Structure)
def bulk(body: BulkRequest) -> Structure:
    return _run(
        lambda: crystal.bulk(
            body.symbol,
            body.crystalstructure,
            body.a,
            body.c,
            cubic=body.cubic,
            orthorhombic=body.orthorhombic,
        )
    )


@router.post("/spacegroup", response_model=Structure)
def from_spacegroup(body: SpacegroupBuildRequest) -> Structure:
    return _run(
        lambda: crystal.from_spacegroup(
            body.symbols, body.basis, body.spacegroup, body.cellpar, body.name
        )
    )


@router.get("/library", response_model=list[LibraryEntry])
def library() -> list[LibraryEntry]:
    return list(crystal.library_entries())


@router.get("/library/{category}/{name}", response_model=Structure)
def library_entry(category: str, name: str) -> Structure:
    try:
        return _run(lambda: crystal.load_entry(category, name))
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
