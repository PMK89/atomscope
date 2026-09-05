# ruff: noqa: E501
from pathlib import Path

import pytest
from ase.build import molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.cppaw.deck import parse_deck
from atomscope.backends.cppaw.plugin import CppawPlugin
from atomscope.backends.cppaw.settings import CppawSettings
from atomscope.backends.cppaw.setups import SetupsLibrary
from atomscope.backends.cppaw.strc import StrcOptions, strc_text

# Synthetic library in the setups.rslv layout (values are placeholders, not course parameters).
LIBRARY = """
!SPECIES NAME='H_' NPRO=1 1 LRHOX=4 RAD/RCOV=1.2
  !AUGMENT ID='TEST_H' EL='H' ZV=1. TYPE='NDLSS' RBOX/RCOV=1.2 RCSM/RCOV=.25 RCL/RCOV=1.2 1.2 1.2 1.2
    !GRID DMIN=1.E-6 DMAX=.15 RMAX=9. !END
    !POT POW=3. RC/RCOV=1.2 !END
    !CORE POW=2. RC/RCOV=1.2 !END
  !END
!END
!SPECIES NAME='O_' NPRO=2 2 1 LRHOX=4 RAD/RCOV=1.4
  !AUGMENT ID='TEST_O' EL='O' ZV=6. TYPE='NDLSS' RBOX/RCOV=1.2 RCSM/RCOV=.25 RCL/RCOV=0.75 0.75 0.75 0.75
    !GRID DMIN=1.E-6 DMAX=.15 RMAX=9. !END
    !POT POW=3. RC/RCOV=0.75 !END
    !CORE POW=2. RC/RCOV=0.75 !END
  !END
!END
"""


def test_library_parsing_and_inlining(tmp_path: Path) -> None:
    lib = SetupsLibrary.from_text(LIBRARY)
    assert lib.elements() == ["H", "O"]
    s = from_atoms(molecule("H2O"))
    text = strc_text(s, StrcOptions(library=lib, hydrogen_mass=2.0))
    strc = parse_deck(text).child("STRUCTURE")
    species = {sp.get("NAME"): sp for sp in strc.children_named("SPECIES")}
    assert set(species) == {"O_", "H_"}
    assert species["O_"].child("AUGMENT").get("ID") == "TEST_O"
    assert species["H_"].get("M") == 2.0 and species["O_"].get("ID") is None
    # elements missing from the library fall back to internal setups
    s2 = from_atoms(molecule("CH4"))
    strc2 = parse_deck(strc_text(s2, StrcOptions(library=lib))).child("STRUCTURE")
    carbon = next(sp for sp in strc2.children_named("SPECIES") if sp.get("NAME") == "C_")
    assert carbon.get("ID") == "C_.75_6.0" and carbon.child("AUGMENT") is None
    with pytest.raises(ValueError, match="no !SPECIES"):
        SetupsLibrary.from_text("!CONTROL !END !EOB")


def test_plugin_uses_configured_library(tmp_path: Path) -> None:
    lib_file = tmp_path / "setups.rslv"
    lib_file.write_text(LIBRARY)
    settings = CppawSettings.from_env()
    settings.setups_file = lib_file
    p = CppawPlugin(settings)
    s = from_atoms(molecule("CH4"))
    rep = p.validate(s, {"setup_source": "library"})
    assert rep.ok and any("no setups for ['C']" in i.message for i in rep.issues)
    gen = p.generate_inputs(from_atoms(molecule("H2O")), {"setup_source": "library"}, "case")
    strc = next(f.text for f in gen.files if f.name == "case.strc")
    assert "TEST_O" in strc and "!AUGMENT" in strc
    settings.setups_file = None
    assert not p.validate(s, {"setup_source": "library"}).ok
