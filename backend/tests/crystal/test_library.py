import pytest

from atomscope import crystal
from atomscope.crystal.library import LIBRARY_DIR, library_path


def test_library_index() -> None:
    entries = crystal.library_entries()
    assert len(entries) == 507
    categories = {e.category for e in entries}
    assert {"elements", "halides", "oxides", "zeolites"} <= categories and len(categories) == 22
    nacl = next(e for e in entries if e.name == "NaCl-Halite")
    assert nacl.category == "halides" and nacl.formula == "NaCl" and nacl.readable
    unreadable = [e for e in entries if not e.readable]
    assert 0 < len(unreadable) < 30
    assert all(e.formula for e in unreadable)  # formula from the CIF tag
    assert (LIBRARY_DIR / "LICENSE-avogadro.txt").is_file()
    assert (LIBRARY_DIR / "README.md").is_file()


def test_load_entry() -> None:
    s = crystal.load_entry("halides", "NaCl-Halite")
    assert s.name == "NaCl-Halite" and s.n_atoms == 8 and s.cell is not None
    assert crystal.perceive_symmetry(s).number == 225
    si = crystal.load_entry("elements", "Si-Silicon")
    assert crystal.perceive_symmetry(si).number == 227
    with pytest.raises(KeyError):
        library_path("halides", "../../etc/passwd")
    with pytest.raises(KeyError):
        crystal.load_entry("nope", "NaCl-Halite")
