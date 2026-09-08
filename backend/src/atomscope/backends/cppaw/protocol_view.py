"""The protocol as a reader uses it: raw text, and the geometries it reports.

CP-PAW's ``.prot`` is both the run's log and its record of what the code actually did. Two things
in it are worth showing directly rather than only through derived charts:

* **The text itself.** It is where a failure explains itself, where every setting the code really
  used is echoed back, and where the tutorial tells the reader to look. Nothing derived replaces
  reading it.
* **The atom lists.** The code prints one per report block, and those are the *reported*
  geometries. Unlike the ``_r.tra`` position trajectory they carry the forces and the lattice, and
  they exist even for a run that wrote no trajectory at all -- which is every static calculation.
"""

from __future__ import annotations

from pathlib import Path

from ase.data import atomic_numbers, chemical_symbols
from ase.units import Bohr, Hartree
from pydantic import Field

from atomscope.backends.cppaw.protocol import AtomListReport, parse_protocol
from atomscope.model.common import StrictModel
from atomscope.model.structure import new_uid
from atomscope.model.trajectory import Frame, Trajectory

#: Forces are printed in milli-Hartree per Bohr (to 0.01 mH/Bohr, see ``results.py``).
MH_PER_BOHR_TO_EV_PER_ANG = 1e-3 * Hartree / Bohr

#: How many lines a text request returns when it does not ask for a number.
DEFAULT_LINES = 400


class ProtocolText(StrictModel):
    """A window onto one protocol file.

    A protocol grows without bound -- a molecular-dynamics run writes one line per step -- so the
    file is served in windows rather than whole, and the default window is the *end*: that is
    where a failure reports itself and where the converged numbers are.
    """

    name: str = Field(description="file name, so the reader knows which file this is")
    total_lines: int
    offset: int = Field(description="0-based index of the first line returned")
    text: str = Field(description="the lines, joined by newlines, exactly as written")
    run_starts: list[int] = Field(
        default_factory=list,
        description="0-based line of each 'PROGRAM STARTED' -- a restart appends to the same file",
    )


def read_protocol_text(
    path: Path, *, offset: int | None = None, limit: int = DEFAULT_LINES
) -> ProtocolText:
    """Read a window of ``path``.

    ``offset=None`` returns the last ``limit`` lines. A negative or out-of-range offset is clamped
    rather than refused, so a client paging backwards cannot fall off the front of the file.

    The text is returned as it was written. It is *data*: it is displayed, never interpreted, and
    the frontend renders it into a ``<pre>`` where React escapes it.
    """
    if not path.is_file():
        msg = f"{path.name} not found"
        raise FileNotFoundError(msg)
    lines = path.read_text(errors="replace").splitlines()
    limit = max(1, limit)
    start = (
        max(0, len(lines) - limit)
        if offset is None
        else min(max(0, offset), max(0, len(lines) - 1))
    )
    window = lines[start : start + limit]
    return ProtocolText(
        name=path.name,
        total_lines=len(lines),
        offset=start,
        text="\n".join(window),
        run_starts=[i for i, line in enumerate(lines) if line.startswith("PROGRAM STARTED")],
    )


def symbol_of(atom_name: str) -> str:
    """The element of a CP-PAW atom name (``O_1`` -> ``O``, ``SI2`` -> ``Si``).

    ``strc.atom_name`` builds these as the symbol upper-cased and padded to two characters with
    ``_``, then a 1-based index -- so the element is recoverable, which matters because the
    protocol is sometimes the only file at hand. An unrecognised name yields ``X``: a protocol
    written by hand rather than by Atomscope may not follow the convention, and inventing an
    element would be worse than admitting the gap.
    """
    head = atom_name.rstrip("0123456789").rstrip("_")
    candidate = head.capitalize()
    if candidate in atomic_numbers:
        return candidate
    return "X" if "X" in chemical_symbols else candidate


def protocol_structures(
    work: Path, root: str, *, symbols: list[str] | None = None
) -> Trajectory | None:
    """The reported geometries of ``work/root.prot`` as a trajectory, or ``None`` if it has none.

    ``symbols`` -- the calculation's own structure -- wins when it is the right length, because it
    carries the element names as the user wrote them. Otherwise they are read off the atom names.

    Energies are aligned at the *end*. A run reports its starting geometry before it has an energy
    for it, so there is normally one more atom list than energy report; matching the two from the
    tail attaches each energy to the geometry it was computed for and leaves the leading geometry
    without one, rather than shifting every energy by a frame.
    """
    prot = parse_protocol(work / f"{root}.prot")
    reports: list[AtomListReport] = [a for a in prot.atom_lists if a.atoms]
    if not reports:
        return None
    n_atoms = len(reports[-1].atoms)
    if symbols is None or len(symbols) != n_atoms:
        symbols = [symbol_of(a.name) for a in reports[-1].atoms]

    energies = [e.total_h for e in prot.energy_reports]
    skew = len(reports) - len(energies)

    frames: list[Frame] = []
    for i, report in enumerate(reports):
        if len(report.atoms) != n_atoms:
            continue  # a report truncated mid-write cannot be a frame of this trajectory
        total_h = energies[i - skew] if skew >= 0 and 0 <= i - skew < len(energies) else None
        forces = (
            [
                tuple(
                    c * MH_PER_BOHR_TO_EV_PER_ANG for c in (a.force_mh_per_bohr or (0.0, 0.0, 0.0))
                )
                for a in report.atoms
            ]
            if report.has_forces
            else None
        )
        frames.append(
            Frame(
                positions=[tuple(a.position_ang) for a in report.atoms],  # type: ignore[misc]
                cell=tuple(report.lattice_ang) if len(report.lattice_ang) == 3 else None,  # type: ignore[arg-type]
                energy=total_h * Hartree if total_h is not None else None,
                forces=forces,  # type: ignore[arg-type]
                step=i,
            )
        )
    if not frames:
        return None
    return Trajectory(
        id=new_uid(),
        name=f"{root}.prot geometries",
        symbols=symbols,
        frames=frames,
        kind="protocol",
    )
