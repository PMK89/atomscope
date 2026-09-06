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
    # the Advanced boxes write DFTTYP and CCTYP without going through the theory box
    for correlated in ({"gamess_functional": "BLYP"}, {"gamess_cc": "ccsd"}):
        report = plugin.validate(water, {**values, **correlated})
        assert any("semi-empirical basis set" in i.message for i in report.issues), correlated
    # and "no coupled cluster at all" is not a correlated method
    assert plugin.validate(water, {**values, "gamess_cc": "none"}).issues == []
    # the Basic theory box's own AM1 and PM3 are a GBASIS too, detailed list or not
    box = {"program": "gamess", "gamess_theory": "am1"}
    assert plugin.validate(water, box).issues == []
    report = plugin.validate(water, {**box, "gamess_functional": "BLYP"})
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


def test_the_gamess_dft_tab_chooses_a_functional_by_its_keyword() -> None:
    """DFTTYP lives in $CONTRL; the grid-free method is the only thing $DFT carries here.

    Avogadro shows one list of labels and looks the chosen index up in whichever of GAMESS's two
    functional enums the method selects, so from GOP on its labels and its keywords disagree.
    Going by keyword is what keeps that out of the deck, and it costs the pairing: a functional
    that GAMESS has in one list only is refused for the other.
    """
    water = from_atoms(molecule("H2O"), name="water")
    base = {"program": "gamess", "task": "energy"}
    grid = plugin.generate_inputs(water, {**base, "gamess_functional": "PBEOP"}, "case")
    assert " $CONTRL SCFTYP=RHF RUNTYP=ENERGY DFTTYP=PBEOP $END" in grid.files[0].text
    assert "$DFT" not in grid.files[0].text

    free = plugin.generate_inputs(
        water, {**base, "gamess_functional": "CAMB", "gamess_dft_method": "gridfree"}, "case"
    )
    lines = free.files[0].text.split("\n")
    assert lines[1] == " $CONTRL SCFTYP=RHF RUNTYP=ENERGY DFTTYP=CAMB $END"
    assert lines[2] == " $DFT METHOD=GRIDFREE $END"

    # the theory box's B3LYP is the same request as choosing B3LYP here
    from_theory = plugin.generate_inputs(water, {**base, "gamess_theory": "b3lyp"}, "case")
    from_box = plugin.generate_inputs(water, {**base, "gamess_functional": "B3LYP"}, "case")
    assert from_theory.files[0].text == from_box.files[0].text

    for values, message in (
        ({"gamess_functional": "CAMB"}, "grid-free list only"),
        ({"gamess_functional": "PBE", "gamess_dft_method": "gridfree"}, "grid list only"),
    ):
        report = plugin.validate(water, {**base, **values})
        assert any(message in i.message for i in report.issues), values


def test_the_gamess_stat_point_and_system_tabs_reach_their_groups() -> None:
    """$STATPT and $SYSTEM, under the conditions their writers impose."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "transition_state",
            "memory_mb": 2000,
            "gamess_opt_method": "rfo",
            "gamess_opttol": 1e-5,
            "gamess_nstep": 40,
            "gamess_initial_radius": 0.2,
            "gamess_max_radius": 0.5,
            "gamess_min_radius": 0.02,
            "gamess_update_radius": False,
            "gamess_initial_hessian": "calculate",
            "gamess_hess_recalc": 5,
            "gamess_follow_mode": 2,
            "gamess_stationary": True,
            "gamess_jump_size": 0.02,
            "gamess_print_orbitals": True,
            "gamess_timlim": 600,
            "gamess_memddi_mb": 8000,
            "gamess_parallel": True,
            "gamess_core_file": True,
            "gamess_kdiag": "jacobi",
            "gamess_balance": "nxtval",
            "gamess_xdr": True,
        },
        "case",
    )
    lines = gen.files[0].text.split("\n")
    assert lines[2] == (
        " $SYSTEM TIMLIM=600 MWORDS=250 MEMDDI=1000 PARALL=.TRUE. KDIAG=3 COREFL=.TRUE."
        " BALTYP=NXTVAL XDR=.TRUE. $END"
    )
    assert lines[3] == (
        " $STATPT OPTTOL=1e-05 NSTEP=40 Method=RFO DXMAX=0.2 TRUPD=.FALSE. TRMAX=0.5 TRMIN=0.02"
        " IFOLOW=2 STPT=.TRUE. STSTEP=0.02 HESS=CALC IHREP=5 NPRT=1 $END"
    )


def test_the_gamess_defaults_still_write_the_two_reminder_keywords() -> None:
    """Everything in those two groups is conditional, and the conditions are Avogadro's.

    A trust radius belongs to the two methods that keep one, the mode to follow only to a
    saddle-point search, and a step size of 0.05 is the default it is not worth writing. What is
    left with nothing asked for is the pair GAMESS would have used anyway.
    """
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(water, {"program": "gamess", "task": "optimize"}, "case")
    lines = gen.files[0].text.split("\n")
    assert lines[2] == " $SYSTEM MWORDS=250 $END"
    assert lines[3] == " $STATPT OPTTOL=0.0001 NSTEP=20 $END"
    # Newton-Raphson keeps no trust radius, and an optimization follows no mode
    trimmed = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "optimize",
            "gamess_opt_method": "nr",
            "gamess_initial_radius": 0.2,
            "gamess_max_radius": 0.5,
            "gamess_follow_mode": 3,
        },
        "case",
    )
    assert trimmed.files[0].text.split("\n")[3] == " $STATPT OPTTOL=0.0001 NSTEP=20 Method=NR $END"


def test_the_gamess_scf_and_mp2_tabs_reach_their_groups() -> None:
    """$SCF and $MP2, in the order and under the conditions of their writers."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "energy",
            "gamess_theory": "mp2",
            "gamess_scftyp": "uhf",
            "gamess_direct_scf": True,
            "gamess_fock_diff": False,
            "gamess_uhf_no": True,
            "gamess_nconv": 8,
            "gamess_mp2_core": 2,
            "gamess_mp2_memory": 1000000,
            "gamess_mp2_cutoff": 1e-10,
            "gamess_mp2_properties": True,
            "gamess_mp2_transformation": "two_phase",
            "gamess_mp2_ao_storage": "duplicated",
        },
        "case",
    )
    lines = gen.files[0].text.split("\n")
    # $SYSTEM comes first, then the wave function's own two groups, in the writers' order
    assert lines[2].startswith(" $SYSTEM ")
    assert lines[3] == " $SCF DIRSCF=.TRUE. FDIFF=.FALSE. NCONV=8 UHFNOS=.TRUE. $END"
    # NBCORE rides with NACORE for a UHF run, and the deck says the transformation only when it
    # is not GAMESS's own; the cutoff keeps the writer's two significant figures
    assert lines[4] == (
        " $MP2 NACORE=2 NBCORE=2 MP2PRP=.TRUE. NWORD=1000000 CUTOFF=1.00e-10 METHOD=3"
        " AOINTS=DUP $END"
    )


def test_neither_gamess_wave_function_group_is_written_by_default() -> None:
    """Both are empty until a box is ticked; an MP2 run is what the second one needs at all."""
    water = from_atoms(molecule("H2O"), name="water")
    plain = plugin.generate_inputs(water, {"program": "gamess"}, "case").files[0].text
    assert " $SCF" not in plain
    assert " $MP2" not in plain
    mp2 = plugin.generate_inputs(
        water, {"program": "gamess", "gamess_theory": "mp2", "gamess_mp2_core": 2}, "case"
    )
    assert " $MP2 NACORE=2 $END" in mp2.files[0].text
    # ...and the same box with any other theory says nothing, as Avogadro's MPLEVL test did
    rhf = plugin.generate_inputs(water, {"program": "gamess", "gamess_mp2_core": 2}, "case")
    assert " $MP2" not in rhf.files[0].text


def test_the_two_boxes_avogadros_writers_forgot_reach_the_deck_here() -> None:
    """UHFNOS and MP2PRP are not in Avogadro's punch tests, so on their own they wrote nothing."""
    water = from_atoms(molecule("H2O"), name="water")
    alone = plugin.generate_inputs(
        water, {"program": "gamess", "gamess_scftyp": "uhf", "gamess_uhf_no": True}, "case"
    )
    assert " $SCF UHFNOS=.TRUE. $END" in alone.files[0].text
    mp2 = plugin.generate_inputs(
        water,
        {"program": "gamess", "gamess_theory": "mp2", "gamess_mp2_properties": True},
        "case",
    )
    assert " $MP2 MP2PRP=.TRUE. $END" in mp2.files[0].text


def test_the_gamess_scf_group_belongs_to_four_wave_functions() -> None:
    """Avogadro punches nothing above GVB, and Fock differencing nothing above ROHF."""
    water = from_atoms(molecule("H2O"), name="water")
    base = {"program": "gamess", "gamess_direct_scf": True, "gamess_fock_diff": False}
    for scftyp, expected in (
        ("rhf", " $SCF DIRSCF=.TRUE. FDIFF=.FALSE. $END"),
        ("gvb", " $SCF DIRSCF=.TRUE. $END"),
        ("mcscf", ""),
    ):
        text = (
            plugin.generate_inputs(water, {**base, "gamess_scftyp": scftyp}, "case").files[0].text
        )
        if expected:
            assert expected in text, scftyp
        else:
            assert " $SCF" not in text, scftyp
    # and the box that cannot reach a deck says so rather than going quiet
    report = plugin.validate(water, {**base, "gamess_scftyp": "mcscf"})
    assert any("does not apply to MCSCF" in i.message for i in report.issues)


def test_the_wave_function_boxes_avogadro_greyed_out_are_reported_here() -> None:
    """Its dialog enabled these for one SCF type each; stored values can carry them anywhere."""
    water = from_atoms(molecule("H2O"), name="water")
    natural = plugin.validate(water, {"program": "gamess", "gamess_uhf_no": True})
    assert any(i.key == "gamess_uhf_no" for i in natural.issues)
    assert (
        plugin.validate(
            water, {"program": "gamess", "gamess_scftyp": "uhf", "gamess_uhf_no": True}
        ).issues
        == []
    )
    for values, message in (
        ({"gamess_guess": "moread"}, "$VEC group"),
        ({"gamess_guess_mix": True}, "singlet UHF run"),
    ):
        report = plugin.validate(water, {"program": "gamess", **values})
        assert any(message in i.message for i in report.issues), values
    localized = plugin.validate(
        water,
        {
            "program": "gamess",
            "gamess_theory": "mp2",
            "gamess_scftyp": "rohf",
            "gamess_mp2_localized": True,
        },
    )
    assert any("closed-shell" in i.message for i in localized.issues)


def test_the_gamess_mo_guess_and_hessian_tabs_reach_their_groups() -> None:
    """$GUESS and $FORCE, in the writers' order and under their conditions."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "frequencies",
            "gamess_guess": "moread",
            "gamess_guess_orbitals": 5,
            "gamess_guess_print": True,
            "gamess_hessian_method": "numeric",
            "gamess_hessian_double": True,
            "gamess_hessian_displacement": 0.02,
            "gamess_hessian_purify": True,
            "gamess_hessian_print_fc": True,
            "gamess_hessian_scale": 0.89,
        },
        "case",
    )
    text = gen.files[0].text
    assert " $GUESS GUESS=MOREAD NORB=5 PRTMO=.TRUE. $END" in text
    # the displacement and the scale factor keep the writer's six decimals
    assert (
        " $FORCE METHOD=SEMINUM NVIB=2 VIBSIZ=0.020000 PURIFY=.TRUE. PRTIFC=.TRUE."
        " VIBANL=.TRUE. SCLFAC=0.890000 $END"
    ) in text


def test_the_gamess_hessian_group_belongs_to_the_runs_that_need_one() -> None:
    """A Hessian run, or a search that starts by computing one -- and nothing else."""
    water = from_atoms(molecule("H2O"), name="water")
    for values, wanted in (
        ({"task": "energy"}, False),
        ({"task": "frequencies"}, True),
        ({"task": "optimize"}, False),
        ({"task": "optimize", "gamess_initial_hessian": "calculate"}, True),
        ({"task": "optimize", "gamess_initial_hessian": "guess"}, False),
    ):
        text = plugin.generate_inputs(water, {"program": "gamess", **values}, "case").files[0].text
        assert (" $FORCE" in text) is wanted, values


def test_a_gamess_hessian_is_analytic_only_where_gamess_has_one() -> None:
    """RHF, ROHF and GVB without a perturbation; a semi-empirical basis is numerical outright."""
    water = from_atoms(molecule("H2O"), name="water")
    base = {"program": "gamess", "task": "frequencies"}
    for values, method in (
        ({}, "ANALYTIC"),
        ({"gamess_scftyp": "uhf"}, "SEMINUM"),
        ({"gamess_theory": "mp2"}, "SEMINUM"),
        ({"gamess_hessian_method": "numeric"}, "SEMINUM"),
        ({"gamess_theory": "am1"}, "NUMERIC"),
    ):
        text = plugin.generate_inputs(water, {**base, **values}, "case").files[0].text
        assert f" $FORCE METHOD={method} " in text, values
    # and the displacement follows the method the deck asks for, which in Avogadro it did not:
    # its analytic/numeric decision was made before it looked at the basis set
    semi = plugin.generate_inputs(
        water, {**base, "gamess_theory": "am1", "gamess_hessian_displacement": 0.02}, "case"
    )
    assert " $FORCE METHOD=NUMERIC VIBSIZ=0.020000 " in semi.files[0].text


def test_the_gamess_orbital_mixing_box_needs_a_singlet_uhf_run() -> None:
    """Avogadro's punch test and its keyword disagreed, so a triplet gave an empty group."""
    water = from_atoms(molecule("H2O"), name="water")
    singlet = plugin.generate_inputs(
        water, {"program": "gamess", "gamess_scftyp": "uhf", "gamess_guess_mix": True}, "case"
    )
    assert " $GUESS MIX=.TRUE. $END" in singlet.files[0].text
    triplet = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "gamess_scftyp": "uhf",
            "gamess_guess_mix": True,
            "multiplicity": 3,
        },
        "case",
    )
    assert " $GUESS" not in triplet.files[0].text
    # ...and the multiplicity MIX answers to is the deck's, which an odd electron count decides
    methyl = plugin.generate_inputs(
        from_atoms(molecule("CH3"), name="methyl"),
        {"program": "gamess", "gamess_scftyp": "uhf", "gamess_guess_mix": True},
        "case",
    )
    assert " MULT=2 " in methyl.files[0].text
    assert " $GUESS" not in methyl.files[0].text


def test_the_gamess_groups_are_written_in_avogadros_order() -> None:
    """One deck with every group in it, in the order of `gamessinputdata.cpp:234-243`."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "task": "transition_state",
            "gamess_theory": "mp2",
            "gamess_scftyp": "uhf",
            "gamess_solvent": "water",
            "gamess_guess": "hcore",
            "gamess_direct_scf": True,
            "gamess_mp2_core": 2,
            "gamess_initial_hessian": "calculate",
        },
        "case",
    )
    groups = [line.split()[0] for line in gen.files[0].text.split("\n") if line.startswith(" $")]
    assert groups == [
        "$BASIS",
        "$PCM",
        "$CONTRL",
        "$SYSTEM",
        "$GUESS",
        "$SCF",
        "$MP2",
        "$STATPT",
        "$FORCE",
        "$DATA",
        "$END",
    ]


def test_the_gamess_misc_tab_writes_its_interfaces_into_control() -> None:
    """The tab's boxes are $CONTRL keywords, and they come after everything else in the group."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "gamess_molplt": True,
            "gamess_pltorb": True,
            "gamess_aimpac": True,
            "gamess_rpac": True,
        },
        "case",
    )
    assert gen.files[0].text.split("\n")[1] == (
        " $CONTRL SCFTYP=RHF RUNTYP=ENERGY MOLPLT=.TRUE. PLTORB=.TRUE. AIMPAC=.TRUE."
        " RPAC=.TRUE. $END"
    )


def test_a_gamess_run_that_writes_another_programs_input_is_a_check_run() -> None:
    """FRIEND is one, so Avogadro leaves EXETYP out beside it -- and the two file interfaces."""
    water = from_atoms(molecule("H2O"), name="water")
    base = {"program": "gamess", "gamess_aimpac": True, "gamess_rpac": True}
    friend = plugin.generate_inputs(
        water, {**base, "gamess_friend": "gaussian", "gamess_exec": "debug"}, "case"
    )
    assert " $CONTRL SCFTYP=RHF RUNTYP=ENERGY FRIEND=GAUSSIAN $END" in friend.files[0].text
    # a check run keeps EXETYP and drops the same two boxes
    check = plugin.generate_inputs(water, {**base, "gamess_exec": "check"}, "case")
    assert " $CONTRL SCFTYP=RHF RUNTYP=ENERGY EXETYP=CHECK $END" in check.files[0].text


def test_the_gamess_data_tab_shapes_the_data_block_and_four_control_keywords() -> None:
    """Its point group and title are the block's; its other boxes are $CONTRL's."""
    water = from_atoms(molecule("H2O"), name="water")
    gen = plugin.generate_inputs(
        water,
        {
            "program": "gamess",
            "gamess_title": "a water molecule",
            "gamess_point_group": "cnv",
            "gamess_axis_order": 2,
            "gamess_coord_type": "cartesian",
            "gamess_nzvar": 3,
            "gamess_use_symmetry": False,
        },
        "case",
    )
    lines = gen.files[0].text.split("\n")
    assert lines[1] == (" $CONTRL SCFTYP=RHF RUNTYP=ENERGY COORD=CART NZVAR=3 NOSYM=1 $END")
    # the title, then the group with the order of its axis, then the blank line GAMESS wants
    # under any group but C1 -- which Avogadro wrote above $DATA, where it separates nothing
    assert lines[3:8] == [
        "",
        " $DATA",
        "a water molecule",
        "CNV 2",
        "",
    ]
    assert lines[8].startswith("O     8.0")
    report = plugin.validate(water, {"program": "gamess", "gamess_point_group": "cnv"})
    assert any("symmetry-unique atoms" in i.message for i in report.issues)


def test_a_gamess_deck_in_bohr_carries_bohr_coordinates() -> None:
    """Avogadro wrote UNITS=BOHR beside the molecule's angstroms; the box converts here."""
    water = from_atoms(molecule("H2O"), name="water")
    angstrom = plugin.generate_inputs(water, {"program": "gamess"}, "case").files[0].text
    bohr = (
        plugin.generate_inputs(water, {"program": "gamess", "gamess_units": "bohr"}, "case")
        .files[0]
        .text
    )
    assert "UNITS=BOHR" in bohr and "UNITS=BOHR" not in angstrom
    z_angstrom = float(
        [line for line in angstrom.split("\n") if line.startswith("O ")][0].split()[-1]
    )
    z_bohr = float([line for line in bohr.split("\n") if line.startswith("O ")][0].split()[-1])
    assert z_bohr == pytest.approx(z_angstrom / 0.5291772, rel=1e-4)
