"""Synchronous chemistry services on posted structures: force fields, hydrogens, perception,
charges, identifiers and chirality edits. All endpoints are pure functions of the request body;
the frontend commits the returned structure as one undo step."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from atomscope.chem import (
    edits,
    forcefield,
    hydrogens,
    pointgroup,
    properties,
    secondary,
    smarts,
)
from atomscope.chem.forcefield import (
    Algorithm,
    ConformerMethod,
    ConformerResult,
    EnergyResult,
    FFConstraint,
    ForceFieldError,
    OptimizeResult,
)
from atomscope.chem.pointgroup import Tolerance
from atomscope.chem.properties import AromaticityResult, ChargeModel, ChargesResult, Identifiers
from atomscope.chem.secondary import SecondaryKind
from atomscope.model import Quantity, Structure
from atomscope.model.common import StrictModel

router = APIRouter(prefix="/api/chem", tags=["chem"])


class ForceFieldInfo(StrictModel):
    force_fields: list[str]
    charge_models: list[str]
    algorithms: list[str] = ["steepest_descent", "conjugate_gradients"]
    conformer_methods: list[str] = ["systematic", "random", "weighted"]


class EnergyRequest(StrictModel):
    structure: Structure
    force_field: str = "MMFF94"
    constraints: list[FFConstraint] = Field(default_factory=list)


class OptimizeRequest(EnergyRequest):
    algorithm: Algorithm = "steepest_descent"
    max_steps: int = Field(default=500, ge=1)
    convergence: float = Field(default=1e-6, gt=0)
    record_every: int = Field(default=0, ge=0, description="0 = no trajectory")


class OptimizeStepRequest(EnergyRequest):
    """A few steps for interactive auto-optimization; ``fixed_atoms`` are pinned this round."""

    algorithm: Algorithm = "steepest_descent"
    steps: int = Field(default=4, ge=1, le=1000)
    fixed_atoms: list[int] = Field(default_factory=list)


class OptimizeStepResponse(StrictModel):
    structure: Structure
    energy: Quantity
    converged: bool


class ConformerRequest(EnergyRequest):
    method: ConformerMethod = "weighted"
    n_conformers: int = Field(default=10, ge=1, le=1000)
    steps: int = Field(default=100, ge=1)


class AtomsRequest(StrictModel):
    structure: Structure
    indices: list[int] | None = Field(default=None, description="None = whole structure")


class AddHydrogensRequest(AtomsRequest):
    ph: float | None = Field(default=None, ge=0, le=14)


class PerceiveRequest(StrictModel):
    structure: Structure
    bond_orders: bool = True


class ChargesRequest(StrictModel):
    structure: Structure
    model: ChargeModel = "gasteiger"


class StructureRequest(StrictModel):
    structure: Structure


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


def _indices(body: AtomsRequest) -> set[int] | None:
    if body.indices is None:
        return None
    n = body.structure.n_atoms
    bad = [i for i in body.indices if i < 0 or i >= n]
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"atom indices out of range: {bad}")
    return set(body.indices)


@router.get("/force-fields", response_model=ForceFieldInfo)
def force_fields() -> ForceFieldInfo:
    return ForceFieldInfo(
        force_fields=forcefield.available_force_fields(),
        charge_models=properties.available_charge_models(),
    )


@router.post("/energy", response_model=EnergyResult)
def energy(body: EnergyRequest) -> EnergyResult:
    try:
        return forcefield.single_point(body.structure, body.force_field, body.constraints)
    except ForceFieldError as exc:
        raise _bad(exc) from exc


@router.post("/optimize", response_model=OptimizeResult)
def optimize(body: OptimizeRequest) -> OptimizeResult:
    try:
        return forcefield.optimize(
            body.structure,
            body.force_field,
            algorithm=body.algorithm,
            max_steps=body.max_steps,
            convergence=body.convergence,
            constraints=body.constraints,
            record_every=body.record_every,
        )
    except ForceFieldError as exc:
        raise _bad(exc) from exc


@router.post("/optimize-step", response_model=OptimizeStepResponse)
def optimize_step(body: OptimizeStepRequest) -> OptimizeStepResponse:
    n = body.structure.n_atoms
    fixed = [FFConstraint(kind="fix", atoms=[i]) for i in body.fixed_atoms if 0 <= i < n]
    try:
        res = forcefield.optimize(
            body.structure,
            body.force_field,
            algorithm=body.algorithm,
            max_steps=body.steps,
            convergence=1e-8,
            constraints=body.constraints + fixed,
        )
    except ForceFieldError as exc:
        raise _bad(exc) from exc
    return OptimizeStepResponse(structure=res.structure, energy=res.energy, converged=res.converged)


@router.post("/conformers", response_model=ConformerResult)
def conformers(body: ConformerRequest) -> ConformerResult:
    try:
        return forcefield.conformer_search(
            body.structure,
            body.force_field,
            method=body.method,
            n_conformers=body.n_conformers,
            steps=body.steps,
            constraints=body.constraints,
        )
    except ForceFieldError as exc:
        raise _bad(exc) from exc


@router.post("/add-hydrogens", response_model=Structure)
def add_hydrogens(body: AddHydrogensRequest) -> Structure:
    return hydrogens.add_hydrogens(body.structure, _indices(body), body.ph)


@router.post("/remove-hydrogens", response_model=Structure)
def remove_hydrogens(body: AtomsRequest) -> Structure:
    return hydrogens.remove_hydrogens(body.structure, _indices(body))


@router.post("/perceive-bonds", response_model=Structure)
def perceive_bonds(body: PerceiveRequest) -> Structure:
    return hydrogens.perceive_bonds(body.structure, bond_orders=body.bond_orders)


@router.post("/partial-charges", response_model=ChargesResult)
def partial_charges(body: ChargesRequest) -> ChargesResult:
    try:
        return properties.partial_charges(body.structure, body.model)
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/aromaticity", response_model=AromaticityResult)
def aromaticity(body: StructureRequest) -> AromaticityResult:
    return properties.aromaticity(body.structure)


@router.post("/identifiers", response_model=Identifiers)
def identifiers(body: StructureRequest) -> Identifiers:
    try:
        return properties.identifiers(body.structure)
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/invert-chirality", response_model=Structure)
def invert_chirality(body: AtomsRequest) -> Structure:
    return edits.invert_chirality(body.structure, _indices(body))


@router.post("/h-to-methyl", response_model=Structure)
def h_to_methyl(body: AtomsRequest) -> Structure:
    idx = _indices(body)
    if idx is None:
        idx = {i for i, a in enumerate(body.structure.atoms) if a.element == "H"}
    return edits.h_to_methyl(body.structure, idx)


class SmartsRequest(StructureRequest):
    pattern: str = Field(description="SMARTS pattern, Open Babel dialect")
    unique: bool = Field(default=True, description="symmetry-unique matches only")


class SmartsResult(StrictModel):
    """Matches of a SMARTS query: one tuple of atom indices per match, plus their union."""

    matches: list[list[int]]
    atoms: list[int]


class SymmetryRequest(StructureRequest):
    tolerance: Tolerance = "normal"


class PointGroupResult(StrictModel):
    """Molecular point group; ``order`` is 0 for the infinite groups of a linear molecule."""

    symbol: str
    order: int
    operations: list[str]
    principal_axis: tuple[float, float, float] | None = None
    tolerance: float


@router.post("/smarts", response_model=SmartsResult)
def select_smarts(body: SmartsRequest) -> SmartsResult:
    try:
        matches = smarts.match(body.structure, body.pattern, unique=body.unique)
    except smarts.SmartsError as exc:
        raise _bad(exc) from exc
    return SmartsResult(
        matches=[list(m) for m in matches],
        atoms=sorted({i for m in matches for i in m}),
    )


@router.post("/point-group", response_model=PointGroupResult)
def point_group(body: SymmetryRequest) -> PointGroupResult:
    try:
        found = pointgroup.detect(body.structure, body.tolerance)
    except ValueError as exc:
        raise _bad(exc) from exc
    return PointGroupResult(
        symbol=found.symbol,
        order=found.order,
        operations=found.operations,
        principal_axis=found.principal_axis,
        tolerance=found.tolerance,
    )


@router.post("/symmetrize", response_model=Structure)
def symmetrize(body: SymmetryRequest) -> Structure:
    try:
        return pointgroup.symmetrize(body.structure, body.tolerance)
    except ValueError as exc:
        raise _bad(exc) from exc


class SecondaryStructureRequest(StrictModel):
    structure: Structure


class ResidueStructure(StrictModel):
    """One residue's assignment. Backbone atoms are uids: an edit renumbers atoms, uids survive."""

    residue: int = Field(description="index into structure.residues")
    name: str
    number: int
    chain: str
    kind: SecondaryKind
    code: str = Field(description="DSSP-like letter: H G I E B T -")
    n: str
    ca: str
    c: str
    o: str


class BackboneHydrogenBond(StrictModel):
    donor: int = Field(description="residue index whose N-H donates")
    acceptor: int = Field(description="residue index whose C=O accepts")
    energy: float = Field(description="Kabsch-Sander energy in kcal/mol")


class SecondaryStructureResult(StrictModel):
    residues: list[ResidueStructure]
    chains: list[list[int]] = Field(description="residue indices in backbone order, one per chain")
    hbonds: list[BackboneHydrogenBond]


@router.post("/secondary-structure", response_model=SecondaryStructureResult)
def secondary_structure(body: SecondaryStructureRequest) -> SecondaryStructureResult:
    """Helix/sheet assignment (DSSP) for a protein, with the backbone the renderer needs."""
    found = secondary.analyse(body.structure)
    atoms = body.structure.atoms
    residues = body.structure.residues
    return SecondaryStructureResult(
        residues=[
            ResidueStructure(
                residue=a.residue,
                name=residues[a.residue].name,
                number=residues[a.residue].number,
                chain=residues[a.residue].chain,
                kind=a.kind,
                code=a.code,
                n=atoms[a.backbone.n].uid,
                ca=atoms[a.backbone.ca].uid,
                c=atoms[a.backbone.c].uid,
                o=atoms[a.backbone.o].uid,
            )
            for a in found.residues
        ],
        chains=found.chains,
        hbonds=[
            BackboneHydrogenBond(donor=d, acceptor=acc, energy=e) for d, acc, e in found.hbonds
        ],
    )
