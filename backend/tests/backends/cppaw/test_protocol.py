from pathlib import Path

from atomscope.backends.cppaw.protocol import parse_protocol, parse_protocol_text

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "cppaw"


def test_si2_rdyn_forces_and_energies() -> None:
    p = parse_protocol(FIX / "si2_rdyn" / "si2.prot")
    assert p.steps and p.steps[-1].nfi >= 30
    assert abs(p.final_energy_h - (-7.9050265)) < 1e-6
    er = p.energy_reports[-1]
    assert abs(er.terms_h["AE  KINETIC"] - 11.082) < 1e-3
    al = p.final_atom_list
    assert al is not None and al.has_forces
    assert [a.name for a in al.atoms] == ["SI1", "SI2"]
    assert abs(al.atoms[1].position_ang[0] - 1.35734) < 1e-5
    assert abs(al.lattice_ang[0][1] - 2.714679) < 1e-6
    assert al.atoms[1].force_mh_per_bohr is not None
    assert p.homo_band_index == 4
    assert abs(p.direct_gap_ev - 2.4687) < 1e-3
    eig = p.eigenvalues[-1]
    assert eig[0].kpoint == 1 and eig[0].spin == 1 and len(eig[0].energies_ev) == 6
    assert abs(eig[0].energies_ev[0] - (-4.337)) < 1e-3
    assert p.error_lines == []


def test_si2_static_has_no_forces() -> None:
    p = parse_protocol(FIX / "si2" / "si2.prot")
    al = p.final_atom_list
    assert al is not None
    assert not al.has_forces
    assert all(a.force_mh_per_bohr is None for a in al.atoms)


def test_h2o_steps_and_spin_polarized_eigenvalues() -> None:
    p = parse_protocol(FIX / "h2o" / "case.prot")
    assert len(p.steps) >= 100
    assert p.steps[0].nfi < p.steps[-1].nfi
    assert abs(p.final_energy_h - p.steps[-1].energy_h) < 1e-3
    al = p.final_atom_list
    assert [a.name for a in al.atoms] == ["O_1", "H_2", "H_3"]
    eig = p.eigenvalues[-1]
    assert eig and {e.spin for e in eig} == {1, 2}  # NSPIN=2
    assert len(eig[0].energies_ev) == 20  # two rows of ten bands


def test_chemical_potential_is_the_last_reported_one() -> None:
    """The Fermi level of a variable-occupation run, as ``DYNOCC`` reports it each iteration.

    Taken from the course's iron reference run, which prints the line five times: once as the
    uninitialised ``0.00E+00`` and then once per report as it converges. The converged value is
    the last one, and the scientific notation of the first has to parse rather than abort.
    """
    text = """OCCUPATIONS
CHEMICAL POTENTIAL.....................................:   0.00E+00 EV

OCCUPATIONS
CHEMICAL POTENTIAL.....................................:   17.50874 EV

OCCUPATIONS
CHEMICAL POTENTIAL.....................................:   17.50403 EV
"""
    assert parse_protocol_text(text).chemical_potential_ev == 17.50403


def test_fixed_chemical_potential_is_not_a_fermi_level() -> None:
    """``FIXED CHEMICAL POTENTIAL`` is an input constraint, printed by the settings report.

    It appears in a grand-canonical run where the electron count is *not* fixed, so reading it as
    the Fermi level would attach a requested potential to a calculation that never reached it.
    """
    text = (
        "OCCUPATIONS VARIABLE\n"
        "FIXED CHEMICAL POTENTIAL...............................:   5.00000 EV\n"
    )
    assert parse_protocol_text(text).chemical_potential_ev is None


def test_fixed_occupation_runs_report_no_fermi_level() -> None:
    # silicon and the molecules fill a fixed set of bands: there is no chemical potential, and
    # the top of the filled states is the reference level instead
    assert parse_protocol(FIX / "si2" / "si2.prot").chemical_potential_ev is None
    assert parse_protocol(FIX / "h2o" / "case.prot").chemical_potential_ev is None
