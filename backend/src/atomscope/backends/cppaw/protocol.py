"""Parser for the CP-PAW protocol file (``<root>.prot``).

The protocol is a human-readable log. The pieces Atomscope needs (verified against real
outputs in ``tests/fixtures/cppaw``):

* Per-step rows starting with ``!>``::

      !>   NFI   T[PSEC]  T[K]  EKIN(PSI)  E(RHO)  ECONS  ANNEE  ANNER

  E(RHO) is the total (Kohn-Sham) energy in Hartree, ECONS the conserved energy, ANNEE/ANNER
  the wave-function/atom friction values.

* ``ENERGY REPORT`` blocks: ``NAME : VALUE H`` lines (Hartree). The first is ``TOTAL ENERGY``.

* ``ATOMLIST REPORT`` blocks: three ``Ti[ANGSTROM]=`` lattice rows, then one row per atom::

      NAME (x, y, z) M[U] MPSI_EFF[U] Q[E] ( fx, fy, fz )

  Positions are in Å. The trailing force vector (milli-Hartree/Bohr) is present only when
  atomic dynamics is enabled (``!RDYN``); otherwise the row ends after Q[E]. Parsers must not
  invent zero forces in that case (a known trap from earlier integrations).

* ``EIGENVALUES [EV] FOR K-POINT n [AND SPIN s]`` blocks with rows ``offset: e1 e2 ...`` in eV
  (the prefix is the band offset of the row), and the
  scalar lines ``BAND INDEX OF HOMO``, ``SMALLEST DIRECT GAP``, ``ABSOLUTE GAP``.

Every report block is kept (the protocol may hold several: initial, periodic NWRITE reports,
final), so trajectories of the reported quantities can be reconstructed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

_STEP = re.compile(r"^\s*!>\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)")
_ENERGY_LINE = re.compile(r"^\s*([A-Z][A-Z0-9 \-()]+?)\s*:\s*([-+]?\d+\.\d+)\s*H\s*$")
_LATTICE = re.compile(r"^T([123])\[ANGSTROM\]=\s*([-\d.Ee+]+)\s+([-\d.Ee+]+)\s+([-\d.Ee+]+)")
_ATOM = re.compile(
    r"^(\S+)\s+\(\s*([-\d.Ee+]+),\s*([-\d.Ee+]+),\s*([-\d.Ee+]+)\)\s+"
    r"([-\d.Ee+]+)\s+([-\d.Ee+]+)\s+([-\d.Ee+]+)"
    r"(?:\s+\(\s*([-\d.Ee+]+),\s*([-\d.Ee+]+),\s*([-\d.Ee+]+)\))?\s*$"
)
_EIG_HEAD = re.compile(r"^EIGENVALUES \[EV\] FOR K-POINT\s+(\d+)(?:\s+AND SPIN\s+(\d+))?")
_EIG_ROW = re.compile(r"^\s*(\d+):\s+(.*)$")
_HOMO = re.compile(r"^BAND INDEX OF HOMO\.*:\s*(\d+)")
_GAP = re.compile(r"^(SMALLEST DIRECT GAP|ABSOLUTE GAP)\.*:\s*([-\d.]+)\s*EV")
_ERROR = re.compile(r"ERROR|STOP IN|ERRORMESSAGE", re.IGNORECASE)


@dataclass
class StepRecord:
    nfi: int
    time_ps: float
    temperature_k: float
    ekin_psi_h: float
    energy_h: float
    econs_h: float
    friction_psi: float
    friction_atoms: float


@dataclass
class AtomRecord:
    name: str
    position_ang: tuple[float, float, float]
    mass_u: float
    mpsi_eff_u: float
    charge_e: float
    force_mh_per_bohr: tuple[float, float, float] | None


@dataclass
class AtomListReport:
    lattice_ang: list[tuple[float, float, float]] = field(default_factory=list)
    atoms: list[AtomRecord] = field(default_factory=list)

    @property
    def has_forces(self) -> bool:
        return bool(self.atoms) and all(a.force_mh_per_bohr is not None for a in self.atoms)


@dataclass
class EnergyReport:
    terms_h: dict[str, float] = field(default_factory=dict)

    @property
    def total_h(self) -> float | None:
        return self.terms_h.get("TOTAL ENERGY")


@dataclass
class Eigenvalues:
    """Eigenvalues (eV) of one k-point and spin channel (spin 1-based as CP-PAW prints it).

    Protocol rows look like ``  0:  e1 ... e10`` / `` 10:  e11 ...``: the prefix is the band
    offset of the row, not a spin index. Non-spin-polarized runs omit ``AND SPIN``; spin is 1.
    """

    kpoint: int
    spin: int = 1
    energies_ev: list[float] = field(default_factory=list)


@dataclass
class ProtocolData:
    steps: list[StepRecord] = field(default_factory=list)
    energy_reports: list[EnergyReport] = field(default_factory=list)
    atom_lists: list[AtomListReport] = field(default_factory=list)
    eigenvalues: list[list[Eigenvalues]] = field(default_factory=list)  # one list per report
    homo_band_index: int | None = None
    direct_gap_ev: float | None = None
    absolute_gap_ev: float | None = None
    error_lines: list[str] = field(default_factory=list)

    @property
    def final_energy_h(self) -> float | None:
        if self.energy_reports and self.energy_reports[-1].total_h is not None:
            return self.energy_reports[-1].total_h
        if self.steps:
            return self.steps[-1].energy_h
        return None

    @property
    def final_atom_list(self) -> AtomListReport | None:
        return self.atom_lists[-1] if self.atom_lists else None


def parse_protocol_text(text: str) -> ProtocolData:  # noqa: PLR0912, PLR0915
    data = ProtocolData()
    lines = text.splitlines()
    i = 0
    n = len(lines)
    current_eigs: list[Eigenvalues] | None = None
    while i < n:
        line = lines[i]
        stripped = line.strip()
        m = _STEP.match(line)
        if m:
            data.steps.append(
                StepRecord(
                    int(m.group(1)),
                    float(m.group(2)),
                    float(m.group(3)),
                    float(m.group(4)),
                    float(m.group(5)),
                    float(m.group(6)),
                    float(m.group(7)),
                    float(m.group(8)),
                )
            )
            i += 1
            continue
        if stripped == "ENERGY REPORT":
            report = EnergyReport()
            i += 2  # skip underline
            while i < n:
                em = _ENERGY_LINE.match(lines[i])
                if not em:
                    break
                report.terms_h[em.group(1).strip()] = float(em.group(2))
                i += 1
            data.energy_reports.append(report)
            current_eigs = []
            data.eigenvalues.append(current_eigs)
            continue
        if stripped == "ATOMLIST REPORT":
            al = AtomListReport()
            i += 2
            while i < n:
                lm = _LATTICE.match(lines[i].strip())
                if not lm:
                    break
                al.lattice_ang.append((float(lm.group(2)), float(lm.group(3)), float(lm.group(4))))
                i += 1
            if i < n and lines[i].strip().startswith("NAME"):
                i += 1
            while i < n:
                am = _ATOM.match(lines[i].strip())
                if not am:
                    break
                force = None
                if am.group(8) is not None:
                    force = (float(am.group(8)), float(am.group(9)), float(am.group(10)))
                al.atoms.append(
                    AtomRecord(
                        am.group(1),
                        (float(am.group(2)), float(am.group(3)), float(am.group(4))),
                        float(am.group(5)),
                        float(am.group(6)),
                        float(am.group(7)),
                        force,
                    )
                )
                i += 1
            data.atom_lists.append(al)
            continue
        hm = _EIG_HEAD.match(stripped)
        if hm:
            eig = Eigenvalues(kpoint=int(hm.group(1)), spin=int(hm.group(2) or 1))
            i += 2
            while i < n:
                rm = _EIG_ROW.match(lines[i])
                if not rm:
                    break
                eig.energies_ev.extend(float(x) for x in rm.group(2).split())
                i += 1
            if current_eigs is None:
                current_eigs = []
                data.eigenvalues.append(current_eigs)
            current_eigs.append(eig)
            continue
        hb = _HOMO.match(stripped)
        if hb:
            data.homo_band_index = int(hb.group(1))
        gm = _GAP.match(stripped)
        if gm:
            if gm.group(1).startswith("SMALLEST"):
                data.direct_gap_ev = float(gm.group(2))
            else:
                data.absolute_gap_ev = float(gm.group(2))
        if _ERROR.search(stripped) and "ERROR" in stripped.upper():
            data.error_lines.append(stripped)
        i += 1
    return data


def parse_protocol(path: Path) -> ProtocolData:
    return parse_protocol_text(path.read_text(errors="replace"))
