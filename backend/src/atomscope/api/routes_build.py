"""Builders: fragment library, peptides, nucleic acids, nanotubes and graphene ribbons."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from atomscope.build import carbon, fragments, nucleic, peptide
from atomscope.build.fragments import FragmentInfo
from atomscope.model import Structure
from atomscope.model.common import StrictModel, Vec3

router = APIRouter(prefix="/api/build", tags=["build"])


class InsertRequest(StrictModel):
    structure: Structure
    fragment_id: str | None = Field(default=None, description="library id 'category/name'")
    fragment: Structure | None = Field(default=None, description="explicit fragment instead")
    position: Vec3 | None = None
    attach_atom: int | None = Field(default=None, description="bond the fragment to this atom")


class PeptideRequest(StrictModel):
    sequence: str
    preset: Literal["straight", "alpha_helix", "beta_sheet", "helix_3_10", "pi_helix", "custom"] = (
        "alpha_helix"
    )
    phi: float | None = None
    psi: float | None = None
    omega: float = 180.0


class NucleicRequest(StrictModel):
    sequence: str
    kind: nucleic.NucleicKind = "dna"
    double_strand: bool = True
    form: nucleic.HelixForm = "B"
    bases_per_turn: float | None = Field(default=None, gt=0)


class NanotubeRequest(StrictModel):
    n: int = Field(ge=1)
    m: int = Field(ge=0)
    length: int = Field(default=1, ge=1)
    bond: float = Field(default=1.42, gt=0)
    symbol: str = "C"
    periodic: bool = True


class GrapheneRequest(StrictModel):
    n: int = Field(ge=1)
    m: int = Field(ge=1)
    kind: Literal["armchair", "zigzag"] = "armchair"
    saturated: bool = True
    bond: float = Field(default=1.42, gt=0)
    periodic: bool = True


class PeptidePresets(StrictModel):
    presets: dict[str, tuple[float, float]]


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/fragments", response_model=list[FragmentInfo])
def list_fragments() -> list[FragmentInfo]:
    return fragments.list_fragments()


@router.get("/fragments/{fragment_id:path}", response_model=Structure)
def get_fragment(fragment_id: str) -> Structure:
    try:
        return fragments.load_fragment(fragment_id)
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/insert", response_model=Structure)
def insert(body: InsertRequest) -> Structure:
    if (body.fragment is None) == (body.fragment_id is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "give exactly one of fragment_id, fragment"
        )
    try:
        frag = body.fragment or fragments.load_fragment(body.fragment_id or "")
        return fragments.insert_fragment(
            body.structure, frag, position=body.position, attach_atom=body.attach_atom
        )
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ValueError as exc:
        raise _bad(exc) from exc


@router.get("/peptide/presets", response_model=PeptidePresets)
def peptide_presets() -> PeptidePresets:
    return PeptidePresets(presets=dict(peptide.PRESETS))


@router.post("/peptide", response_model=Structure)
def build_peptide(body: PeptideRequest) -> Structure:
    if body.preset == "custom":
        if body.phi is None or body.psi is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "custom preset needs phi and psi")
        phi, psi = body.phi, body.psi
    else:
        phi, psi = peptide.PRESETS[body.preset]
    try:
        return peptide.build_peptide(body.sequence, phi=phi, psi=psi, omega=body.omega)
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/nucleic", response_model=Structure)
def build_nucleic(body: NucleicRequest) -> Structure:
    try:
        return nucleic.build_nucleic(
            body.sequence,
            kind=body.kind,
            double_strand=body.double_strand,
            form=body.form,
            bases_per_turn=body.bases_per_turn,
        )
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/nanotube", response_model=Structure)
def build_nanotube(body: NanotubeRequest) -> Structure:
    try:
        return carbon.build_nanotube(
            body.n,
            body.m,
            length=body.length,
            bond=body.bond,
            symbol=body.symbol,
            periodic=body.periodic,
        )
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/graphene", response_model=Structure)
def build_graphene(body: GrapheneRequest) -> Structure:
    try:
        return carbon.build_graphene_ribbon(
            body.n,
            body.m,
            kind=body.kind,
            saturated=body.saturated,
            bond=body.bond,
            periodic=body.periodic,
        )
    except ValueError as exc:
        raise _bad(exc) from exc
