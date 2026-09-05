# ruff: noqa: E501, PLC0415
import pytest
from ase.build import bulk, molecule

from atomscope.ase_bridge import from_atoms
from atomscope.backends.base import BackendPlugin
from atomscope.backends.qc_inputs import plugin
from atomscope.backends.registry import default_registry


def test_registered_and_non_executing() -> None:
    assert isinstance(plugin, BackendPlugin)
    assert default_registry().get("qc_inputs") is plugin
    assert plugin.capabilities.executes is False


@pytest.mark.parametrize(
    "program,ext,tokens",
    [
        ("orca", ".inp", ["! B3LYP def2-SVP Opt", "%pal nprocs 4", "*xyz -1 2", "O "]),
        ("gaussian", ".gjf", ["b3lyp", "def2-SVP".lower(), "-1 2", "opt"]),
        ("nwchem", ".nw", ["charge -1", "xc B3LYP".lower(), "mult 2", "task dft optimize"]),
        ("gamess", ".inp", ["runtyp=optimize", "icharg=-1", "mult=2", "dfttyp=b3lyp"]),
        ("mopac", ".mop", ["pm7", "charge=-1", "doublet uhf", "o "]),
    ],
)
def test_molecular_inputs(program: str, ext: str, tokens: list[str]) -> None:
    s = from_atoms(molecule("OH"), name="hydroxyl")
    s.charge = -1.0
    s.multiplicity = 2
    gen = plugin.generate_inputs(s, {"program": program, "task": "optimize", "nprocs": 4}, "case")
    assert gen.files[0].name == f"case{ext}"
    text = gen.files[0].text.lower()
    for token in tokens:
        assert token.lower() in text, (program, token, gen.files[0].text)
    assert (
        plugin.generate_inputs(s, {"program": program, "task": "optimize", "nprocs": 4}, "case")
        == gen
    )


def test_mopac_deck_layout() -> None:
    """MOPAC reads the first three lines by position: keywords, title, comment."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(water, {"program": "mopac", "task": "energy"}, "case")
    lines = gen.files[0].text.split("\n")
    # a single point is 1SCF, a closed shell needs no UHF, and a neutral molecule no CHARGE
    assert lines[0] == "PM7 1SCF SINGLET"
    assert lines[1] == "case" and lines[2] == ""
    # every coordinate carries its optimization flag, which is what MOPAC expects
    assert lines[3].split() == ["O", "0.00000000", "1", "0.00000000", "1", "0.11926200", "1"]
    # keywords, title and one line per atom; the comment line is the only blank one
    assert len([x for x in lines if x.strip()]) == 5

    # an optimization is MOPAC's default, so it has no keyword of its own
    opt = plugin.generate_inputs(water, {"program": "mopac", "task": "optimize"}, "case")
    assert opt.files[0].text.split("\n")[0] == "PM7 SINGLET"
    freq = plugin.generate_inputs(
        water, {"program": "mopac", "task": "frequencies", "mopac_method": "MNDOD"}, "case"
    )
    assert freq.files[0].text.split("\n")[0] == "MNDOD FORCE SINGLET"
    # extra keywords are appended to the keyword line, where MOPAC wants them
    extra = plugin.generate_inputs(
        water, {"program": "mopac", "task": "energy", "extra_keywords": "PRECISE EPS=78.4"}, "c"
    )
    assert extra.files[0].text.split("\n")[0] == "PM7 1SCF SINGLET PRECISE EPS=78.4"


def test_periodic_inputs_and_warnings() -> None:
    si = from_atoms(bulk("Si"), name="si")
    qe = plugin.generate_inputs(
        si, {"program": "espresso", "kpts": [6, 6, 6], "ecutwfc": 50.0}, "case"
    )
    text = qe.files[0].text
    assert "calculation" in text and "ecutwfc" in text and "6 6 6" in text and "Si.UPF" in text
    ab = plugin.generate_inputs(si, {"program": "abinit"}, "case")
    assert "ngkpt" in ab.files[0].text and "ecut" in ab.files[0].text
    rep = plugin.validate(from_atoms(molecule("H2O")), {"program": "espresso"})
    assert rep.ok and any("periodic cell" in i.message for i in rep.issues)
    rep2 = plugin.validate(si, {"program": "orca"})
    assert any("ignored" in i.message for i in rep2.issues)


def test_run_refused() -> None:
    from pathlib import Path

    from atomscope.backends.base import Resources

    with pytest.raises(RuntimeError, match="only generates"):
        plugin.run_spec(
            Path("."),
            Path("."),
            plugin.generate_inputs(from_atoms(molecule("H2")), {}, "c"),
            Resources(),
        )
