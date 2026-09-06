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
        ("mopac", ".mop", ["pm7", "charge=-1", "doublet uhf", "\n o "]),
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


def test_mopac_multiplicity_is_a_word_it_has() -> None:
    water = from_atoms(molecule("H2O"), name="water")
    water.multiplicity = 6
    deck = plugin.generate_inputs(water, {"program": "mopac"}, "case").files[0].text
    # the default task is a single point, hence 1SCF
    assert deck.split("\n")[0] == "PM7 1SCF SEXTET UHF"
    # beyond a nonet MOPAC has no word, and writing SINGLET instead would be a deck that runs
    water.multiplicity = 12
    with pytest.raises(ValueError, match="nonet"):
        plugin.generate_inputs(water, {"program": "mopac"}, "case")


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


def test_gaussian_deck_layout() -> None:
    """Avogadro's Gaussian dialog, line for line: link-0, route, title, charge, geometry."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gaussian",
            "task": "optimize",
            "method": "B3LYP",
            "basis": "6-31G(d)",
            "nprocs": 4,
            "gaussian_output": "molden",
            "gaussian_checkpoint": True,
        },
        "case",
    )
    lines = gen.files[0].text.split("\n")
    assert lines[0] == "%NProcShared=4"
    assert lines[1] == "%Mem=2000MB"
    # the checkpoint is named after the deck, as Avogadro named it when it saved
    assert lines[2] == "%Chk=case.chk"
    # Molden's reader needs the basis and the orbitals printed, which is what those keywords do
    assert lines[3] == "#n B3LYP/6-31G(d) Opt gfprint pop=full"
    assert lines[4] == "" and lines[5] == " water" and lines[6] == ""
    assert lines[7] == "0 1"
    assert lines[8].split() == ["O", "0.00000", "0.00000", "0.11926"]
    assert lines[-1] == "" and lines[-2] == ""  # Gaussian wants the deck to end blank


def test_a_semi_empirical_gaussian_route_has_no_basis_set() -> None:
    """`#n AM1/6-31G(d)` is not a calculation; Avogadro greyed the basis box out for AM1 and PM3."""
    water = from_atoms(molecule("H2O"), name="water")
    for method, route in (
        ("AM1", "#n AM1 SP"),
        ("PM6", "#n PM6 SP"),
        ("PM7", "#n PM7 SP"),
        ("pm3", "#n pm3 SP"),
        ("RHF", "#n RHF/STO-3G SP"),
    ):
        gen = plugin.generate_inputs(
            water,
            {"program": "gaussian", "task": "energy", "method": method, "basis": "STO-3G"},
            "case",
        )
        assert gen.files[0].text.split("\n")[1] == route


def test_a_gaussian_deck_can_carry_a_z_matrix() -> None:
    """The Format box: the same geometry as internal coordinates, in either of its two layouts."""
    from atomscope.chem.zmatrix import zmatrix  # noqa: PLC0415

    ethanol = from_atoms(molecule("CH3CH2OH"), name="ethanol")
    values = {"program": "gaussian", "task": "energy", "method": "RHF", "basis": "STO-3G"}
    verbose = plugin.generate_inputs(ethanol, {**values, "coordinates": "zmatrix"}, "case")
    body = verbose.files[0].text.split("\n")
    start = body.index("0 1") + 1
    rows = zmatrix(ethanol)
    assert body[start] == rows[0].element  # the first atom is measured against nothing
    assert body[start + 1] == f"{rows[1].element:<3} {rows[1].a + 1} B1"
    assert body[start + 2] == f"{rows[2].element:<3} {rows[2].a + 1} B2 {rows[2].b + 1} A2"
    variables = body[body.index("Variables:") + 1 :]
    assert variables[0] == f"B1{rows[1].distance:15.5f}"
    assert variables[1] == f"B2{rows[2].distance:15.5f}"
    assert variables[2] == f"A2{rows[2].angle:15.5f}"

    compact = plugin.generate_inputs(ethanol, {**values, "coordinates": "zmatrix_compact"}, "case")
    body = compact.files[0].text.split("\n")
    assert "Variables:" not in body
    assert body[body.index("0 1") + 2].split() == [
        rows[1].element,
        str(rows[1].a + 1),
        f"{rows[1].distance:.5f}",
    ]
