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
        # GAMESS has boxes of its own; RHF/6-31G(d) is what they default to
        ("gamess", ".inp", ["runtyp=optimize", "icharg=-1", "mult=2", "gbasis=n31 ngauss=6"]),
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


def test_gamess_deck_layout() -> None:
    """A GAMESS deck is groups of keywords; Avogadro wrote them in this order.

    The keywords each Basic Setup box stands for are the ones its own source spells out in the
    comments beside them (`gamessinputdialog.cpp:1714-1795`).
    """
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "optimize",
            "gamess_theory": "b3lyp",
            "gamess_basis": "n31dp",
            "gamess_solvent": "water",
            "memory_mb": 2000,
        },
        "case",
    )
    lines = gen.files[0].text.split("\n")
    assert lines[0] == " $BASIS GBASIS=N31 NGAUSS=6 NDFUNC=1 NPFUNC=1 $END"
    assert lines[1] == " $PCM SOLVNT=WATER $END"
    assert lines[2] == " $CONTRL SCFTYP=RHF RUNTYP=OPTIMIZE DFTTYP=B3LYP $END"
    # a GAMESS word is eight bytes, so MWORDS is the megabytes over eight
    assert lines[3] == " $SYSTEM MWORDS=250 $END"
    # every optimization carries this group, values and all, as Avogadro's did: they are GAMESS's
    # own defaults and it wrote them to remind the user of them
    assert lines[4] == " $STATPT OPTTOL=0.0001 NSTEP=20 $END"
    assert lines[5] == "" and lines[6] == " $DATA" and lines[7] == "water" and lines[8] == "C1"
    # every atom carries its nuclear charge, which is what $DATA holds beside the coordinates
    assert lines[9].split() == ["O", "8.0", "0.00000", "0.00000", "0.11926"]
    assert lines[12] == " $END"


def test_a_semi_empirical_gamess_theory_is_a_basis_set() -> None:
    """AM1 and PM3 are what GAMESS calls a GBASIS, and they take none of the basis options."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {"program": "gamess", "task": "energy", "gamess_theory": "am1", "gamess_basis": "n311_2dp"},
        "case",
    )
    assert gen.files[0].text.split("\n")[0] == " $BASIS GBASIS=AM1 $END"


def test_a_gamess_core_potential_reaches_both_groups() -> None:
    """SBKJC is a basis and an effective core potential, and $CONTRL has to say the second."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {"program": "gamess", "task": "energy", "gamess_basis": "core_potential"},
        "case",
    )
    lines = gen.files[0].text.split("\n")
    assert lines[0] == " $BASIS GBASIS=SBKJC NDFUNC=1 $END"
    assert lines[1] == " $CONTRL SCFTYP=RHF RUNTYP=ENERGY ECP=SBKJC $END"


def test_an_odd_number_of_electrons_is_not_a_singlet() -> None:
    """Avogadro forced ROHF and a doublet when the electron count said the choice was impossible."""
    radical = from_atoms(molecule("OH"), name="hydroxyl")
    gen = plugin.generate_inputs(radical, {"program": "gamess", "task": "energy"}, "case")
    assert " SCFTYP=ROHF RUNTYP=ENERGY MULT=2 " in gen.files[0].text


def test_only_gamess_writes_a_transition_state_deck() -> None:
    """The other generators have no saddle-point keyword here, and say so rather than guessing."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(water, {"program": "gamess", "task": "transition_state"}, "case")
    text = gen.files[0].text
    assert "RUNTYP=SADPOINT" in text
    # a saddle-point run is a stationary-point search, and carries the group an optimization does
    assert " $STATPT OPTTOL=0.0001 NSTEP=20 $END" in text
    # a frequency run is not, and does not
    energy = plugin.generate_inputs(water, {"program": "gamess", "task": "frequencies"}, "case")
    assert "$STATPT" not in energy.files[0].text
    report = plugin.validate(water, {"program": "orca", "task": "transition_state"})
    assert any("transition-state" in i.message for i in report.issues)
    with pytest.raises(ValueError, match="no transition-state deck"):
        plugin.generate_inputs(water, {"program": "orca", "task": "transition_state"}, "case")


def test_the_gamess_advanced_basis_tab_is_one_control_per_keyword() -> None:
    """Avogadro's Advanced Basis tab: the basis set, then the functions added to it."""
    water = from_atoms(molecule("H2O"), name="water")
    detailed = {
        "program": "gamess",
        "task": "energy",
        "gamess_detail": True,
        "gamess_gbasis": "n311_6",
        "gamess_ndfunc": 2,
        "gamess_nffunc": 1,
        "gamess_npfunc": 1,
        "gamess_polarization": "popn311",
        "gamess_diffuse_s": True,
        "gamess_diffuse_sp": True,
    }
    text = plugin.generate_inputs(water, detailed, "case").files[0].text
    assert text.split("\n")[0] == (
        " $BASIS GBASIS=N311 NGAUSS=6 NDFUNC=2 NFFUNC=1 NPFUNC=1 POLAR=POPN311"
        " DIFFSP=.TRUE. DIFFS=.TRUE. $END"
    )
    # POLAR names which set the exponents come from, so it says nothing without any of them
    plain = plugin.generate_inputs(
        water, {**detailed, "gamess_ndfunc": 0, "gamess_nffunc": 0, "gamess_npfunc": 0}, "case"
    )
    assert "POLAR" not in plain.files[0].text


def test_a_gamess_basis_that_carries_a_core_potential_keeps_it() -> None:
    """SBKJC and Hay/Wadt imply their own ECP; another can still be chosen over it."""
    water = from_atoms(molecule("H2O"), name="water")
    values = {"program": "gamess", "task": "energy", "gamess_detail": True}
    implied = plugin.generate_inputs(water, {**values, "gamess_gbasis": "sbkjc"}, "case")
    assert " $CONTRL SCFTYP=RHF RUNTYP=ENERGY ECP=SBKJC $END" in implied.files[0].text
    chosen = plugin.generate_inputs(
        water, {**values, "gamess_gbasis": "hw", "gamess_ecp": "read"}, "case"
    )
    assert " $CONTRL SCFTYP=RHF RUNTYP=ENERGY ECP=READ $END" in chosen.files[0].text
    # and a basis that implies none says nothing about it
    plain = plugin.generate_inputs(water, {**values, "gamess_gbasis": "n31_6"}, "case")
    assert "ECP=" not in plain.files[0].text


def test_the_basic_and_detailed_gamess_basis_boxes_agree_where_they_overlap() -> None:
    """The Basic tab's entries are shorthand for the Advanced tab's controls, and have to match."""
    water = from_atoms(molecule("H2O"), name="water")
    for basic, detail in (
        ("sto3g", {"gamess_gbasis": "sto3g"}),
        ("mini", {"gamess_gbasis": "mini"}),
        ("n21", {"gamess_gbasis": "n21_3"}),
        ("n31d", {"gamess_gbasis": "n31_6", "gamess_ndfunc": 1}),
        ("n31dp", {"gamess_gbasis": "n31_6", "gamess_ndfunc": 1, "gamess_npfunc": 1}),
        (
            "n31plus_dp",
            {
                "gamess_gbasis": "n31_6",
                "gamess_ndfunc": 1,
                "gamess_npfunc": 1,
                "gamess_diffuse_sp": True,
            },
        ),
        (
            "n311_2dp",
            {
                "gamess_gbasis": "n311_6",
                "gamess_ndfunc": 1,
                "gamess_npfunc": 1,
                "gamess_diffuse_sp": True,
                "gamess_diffuse_s": True,
            },
        ),
        ("core_potential", {"gamess_gbasis": "sbkjc", "gamess_ndfunc": 1}),
    ):
        values = {"program": "gamess", "task": "energy"}
        from_basic = plugin.generate_inputs(water, {**values, "gamess_basis": basic}, "case")
        from_detail = plugin.generate_inputs(
            water, {**values, "gamess_detail": True, **detail}, "case"
        )
        assert from_basic.files[0].text == from_detail.files[0].text, basic


def test_a_semi_empirical_gamess_basis_takes_no_correlated_theory() -> None:
    """MNDO, AM1 and PM3 are basis sets in the detailed list, and DFT on top of one is nonsense."""
    water = from_atoms(molecule("H2O"), name="water")
    values = {"program": "gamess", "task": "energy", "gamess_detail": True, "gamess_gbasis": "am1"}
    assert plugin.validate(water, values).issues == []
    report = plugin.validate(water, {**values, "gamess_theory": "b3lyp"})
    assert any("semi-empirical basis set" in i.message for i in report.issues)


def test_the_gamess_control_tab_reaches_every_keyword_it_owns() -> None:
    """$CONTRL keyword by keyword, in the order Avogadro punched them."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "optimize",
            "gamess_scftyp": "uhf",
            "gamess_runtyp": "irc",
            "gamess_exec": "check",
            "gamess_ci": "guga",
            "gamess_maxit": 50,
            "gamess_localization": "boys",
        },
        "case",
    )
    text = gen.files[0].text
    assert text.split("\n")[1] == (
        " $CONTRL SCFTYP=UHF RUNTYP=IRC EXETYP=CHECK CITYP=GUGA MAXIT=50 LOCAL=BOYS $END"
    )
    # $STATPT belongs to a search for a stationary point, and an IRC is not one
    assert "$STATPT" not in text


def test_the_gamess_run_type_wins_over_the_calculation_type_and_says_so() -> None:
    """Two boxes can ask for different runs; the deck can only say one, and it is the specific."""
    water = from_atoms(molecule("H2O"), name="water")
    values = {"program": "gamess", "task": "optimize", "gamess_runtyp": "raman"}
    assert "RUNTYP=RAMAN" in plugin.generate_inputs(water, values, "case").files[0].text
    warning = [i for i in plugin.validate(water, values).issues if i.key == "gamess_runtyp"]
    assert warning and warning[0].severity == "warning"
    # the same run under both names is no surprise and says nothing
    agreeing = {**values, "gamess_runtyp": "optimize"}
    assert not [i for i in plugin.validate(water, agreeing).issues if i.key == "gamess_runtyp"]


def test_a_gamess_run_with_no_scf_says_which_ci_it_is() -> None:
    """`None (CI)` is an SCF type, and GAMESS then needs CITYP even when no kind was picked."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water, {"program": "gamess", "task": "energy", "gamess_scftyp": "none"}, "case"
    )
    assert gen.files[0].text.split("\n")[1] == " $CONTRL SCFTYP=NONE RUNTYP=ENERGY CITYP=NONE $END"


def test_the_gamess_coupled_cluster_box_reaches_the_eight_the_theory_list_cannot() -> None:
    """CCTYP has nine values in the Control tab; the Basic theory box offers one of them."""
    water = from_atoms(molecule("H2O"), name="water")
    base = {"program": "gamess", "task": "energy"}
    # the one they share writes the same deck either way, which is what makes it a shorthand
    from_theory = plugin.generate_inputs(water, {**base, "gamess_theory": "ccsd_t"}, "case")
    from_box = plugin.generate_inputs(water, {**base, "gamess_cc": "ccsd_t"}, "case")
    assert from_theory.files[0].text == from_box.files[0].text
    other = plugin.generate_inputs(water, {**base, "gamess_cc": "cr_eom"}, "case")
    assert " $CONTRL SCFTYP=RHF RUNTYP=ENERGY CCTYP=CR-EOM $END" in other.files[0].text
    # and `None` is a choice, not an absence: it turns the theory box's CCSD(T) off
    off = plugin.generate_inputs(
        water, {**base, "gamess_theory": "ccsd_t", "gamess_cc": "none"}, "case"
    )
    assert "CCTYP" not in off.files[0].text


def test_a_stored_gamess_run_type_that_no_longer_exists_is_reported() -> None:
    """Values outlive schemas; a stale one has to come back as an issue, not a KeyError."""
    water = from_atoms(molecule("H2O"), name="water")
    report = plugin.validate(water, {"program": "gamess", "gamess_runtyp": "nonsense"})
    assert any("no such run type" in i.message for i in report.issues)
