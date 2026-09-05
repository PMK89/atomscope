from pathlib import Path

from atomscope.backends.cppaw.protocol import parse_protocol

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
