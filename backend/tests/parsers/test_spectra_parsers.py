"""Golden tests for the spectroscopy parsers against the fixtures in fixtures/spectra.

Reference values were read by hand out of the fixture files; see
``backend/tests/fixtures/spectra/PROVENANCE.md`` for where each file came from.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from atomscope.analysis.spectra import ir_spectrum, nmr_spectrum, uvvis_spectrum
from atomscope.parsers.gaussian_log import parse_gaussian_log, read_gaussian_log
from atomscope.parsers.orca_out import parse_orca_output, read_orca_output
from atomscope.parsers.qchem_out import read_qchem_output
from atomscope.parsers.spectra_common import SpectraParseError
from atomscope.parsers.spectrum_files import (
    read_jcamp_dx,
    read_spectrum_file,
    read_turbomole_spectrum,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "spectra"

# hand-written excerpt in Gaussian's freq=hpmodes layout (five modes per block, five decimals)
HPMODES = """
                          Standard orientation:
 ---------------------------------------------------------------------
 Center     Atomic     Atomic              Coordinates (Angstroms)
 Number     Number      Type              X           Y           Z
 ---------------------------------------------------------------------
    1          8             0        0.000000    0.000000    0.117000
    2          1             0        0.000000    0.757000   -0.469000
    3          1             0        0.000000   -0.757000   -0.469000
 ---------------------------------------------------------------------
 Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering
 activities (A**4/AMU), depolarization ratios for plane and unpolarized
 incident light, reduced masses (AMU), force constants (mDyne/A),
 and normal coordinates:
                    1         2         3
                    A1        A1        B2
 Frequencies ---  1638.4321 3812.1234 3922.5678
 Reduced masses ---  1.0823    1.0450    1.0819
 Force constants ---  1.7118    8.9482    9.8065
 IR Intensities ---  67.2345   4.5678   42.1098
 Coord Atom Element:
   1     1     8     0.00000   0.00000   0.00000
   2     1     8     0.00000   0.00000  -0.06600
   3     1     8    -0.06800   0.05000   0.00000
   1     2     1     0.00000   0.00000   0.00000
   2     2     1    -0.41700   0.58200   0.52400
   3     2     1     0.53900  -0.39700   0.00000
   1     3     1     0.00000   0.00000   0.00000
   2     3     1     0.41700   0.58200  -0.52400
   3     3     1     0.53900   0.39700   0.00000
"""


def test_gaussian_methane_frequencies_and_intensities() -> None:
    parsed = read_gaussian_log(FIXTURES / "methane.g03")
    v = parsed.vibrations
    assert v is not None
    # the fixture carries a ghost atom (Bq, atomic number 0); it must not reach the model
    assert parsed.symbols == ["C", "H", "H", "H", "H"]
    assert len(parsed.positions) == 5
    frequencies = [m.frequency for m in v.modes]
    assert frequencies[3] == pytest.approx(1575.7247)
    assert frequencies[-1] == pytest.approx(2778.9718)
    assert v.modes[3].ir_intensity == pytest.approx(13.7596)
    assert v.modes[3].raman_activity == pytest.approx(3.4382)
    assert all(len(m.displacements) == 5 for m in v.modes)
    # "Zero-point vibrational energy 27.47516 (Kcal/Mol)" in the fixture
    assert v.zero_point_energy is not None
    assert v.zero_point_energy * 23.0605 == pytest.approx(27.475, abs=0.02)


def test_gaussian_benzene_has_thirty_modes_seven_of_them_ir_active() -> None:
    """Benzene is D6h: 3N-6 = 30 modes, IR-active only in A2u (1) and E1u (3 x 2 = 6)."""
    parsed = read_gaussian_log(FIXTURES / "benzene_freq.g03")
    v = parsed.vibrations
    assert v is not None
    assert len(parsed.symbols) == 12
    assert len(v.modes) == 30
    active = [m for m in v.modes if (m.ir_intensity or 0.0) > 0.0]
    assert len(active) == 7
    assert {m.symmetry for m in active} == {"A2U", "E1U"}
    assert sum(m.symmetry == "E1U" for m in active) == 6
    assert all((m.ir_intensity or 0.0) == 0.0 for m in v.modes if m.symmetry not in ("A2U", "E1U"))


def test_gaussian_high_precision_block_is_read() -> None:
    parsed = parse_gaussian_log(HPMODES, source="hpmodes")
    v = parsed.vibrations
    assert v is not None
    assert v.method == "Gaussian (hpmodes)"
    assert [m.frequency for m in v.modes] == pytest.approx([1638.4321, 3812.1234, 3922.5678])
    assert v.modes[0].ir_intensity == pytest.approx(67.2345)
    assert v.modes[0].symmetry == "A1" and v.modes[2].symmetry == "B2"
    assert all(len(m.displacements) == 3 for m in v.modes)
    # the hpmodes table is coordinate-major: (coord=2, atom=2) is the y of the first H, which the
    # parser renormalises, so check the normalisation-invariant ratio to (coord=3, atom=2)
    d = v.modes[0].displacements
    assert d[1][1] / d[1][2] == pytest.approx(-0.417 / 0.539, rel=1e-6)
    assert d[0][0] == 0.0 and d[0][1] == 0.0  # oxygen x and y are printed as zero
    assert np.linalg.norm(np.asarray(d)) == pytest.approx(1.0)


def test_gaussian_without_a_frequency_block_raises() -> None:
    with pytest.raises(SpectraParseError, match="Frequencies"):
        parse_gaussian_log("Entering Gaussian System\n SCF Done: -40.5\n")


def test_orca_caffeine_modes_intensities_and_zero_point_energy() -> None:
    parsed = read_orca_output(FIXTURES / "caffeine_orca.out")
    v = parsed.vibrations
    assert v is not None
    assert len(parsed.symbols) == 24
    assert len(v.modes) == 72  # ORCA prints the full 3N set including the six trivial ones
    assert v.modes[0].frequency == pytest.approx(0.0)
    assert v.modes[6].frequency == pytest.approx(25.60)
    assert v.modes[71].frequency == pytest.approx(3164.40)
    # modes 0-5 are not listed in the IR table, so they carry no intensity (not zero)
    assert all(m.ir_intensity is None for m in v.modes[:7])
    assert v.modes[7].ir_intensity == pytest.approx(0.038378)
    assert v.modes[60].ir_intensity == pytest.approx(88.775009)
    # displacement vectors of the real modes are normalised; the trivial ones are printed as zero
    assert np.linalg.norm(np.asarray(v.modes[7].displacements)) == pytest.approx(1.0)
    assert np.linalg.norm(np.asarray(v.modes[0].displacements)) == pytest.approx(0.0)
    # "Zero point energy ... 0.18276642 Eh  114.69 kcal/mol"
    assert v.zero_point_energy is not None
    assert v.zero_point_energy * 23.0605 == pytest.approx(114.69, abs=0.1)


def test_orca_without_a_frequency_block_raises() -> None:
    with pytest.raises(SpectraParseError, match="VIBRATIONAL FREQUENCIES"):
        parse_orca_output("O   R   C   A\nTOTAL SCF ENERGY\n")


def test_qchem_methane_vibrations() -> None:
    parsed = read_qchem_output(FIXTURES / "methane_qchem.out")
    v = parsed.vibrations
    assert v is not None
    assert parsed.symbols == ["C", "H", "H", "H", "H"]
    assert len(v.modes) == 9  # Q-Chem prints only the 3N-6 vibrations
    assert v.modes[0].frequency == pytest.approx(1575.73)
    assert v.modes[0].ir_intensity == pytest.approx(13.763)
    assert v.modes[-1].frequency == pytest.approx(2778.94)
    # the TransDip row must not be mistaken for a sixth atom
    assert all(len(m.displacements) == 5 for m in v.modes)
    # "Zero point vibrational energy: 27.475 kcal/mol"
    assert v.zero_point_energy is not None
    assert v.zero_point_energy * 23.0605 == pytest.approx(27.475, abs=0.02)


def test_qchem_methanol_nmr_shieldings() -> None:
    parsed = read_qchem_output(FIXTURES / "ch3oh_nmr.qcout")
    assert parsed.vibrations is None
    assert [s.element for s in parsed.shieldings] == ["C", "O", "H", "H", "H", "H"]
    assert parsed.shieldings[0].isotropic == pytest.approx(139.54974364)
    assert parsed.shieldings[0].anisotropic == pytest.approx(74.34978117)
    assert parsed.shieldings[5].isotropic == pytest.approx(32.25366963)


def test_nmr_spectrum_selects_one_nucleus_and_applies_the_reference() -> None:
    parsed = read_qchem_output(FIXTURES / "ch3oh_nmr.qcout")
    spectrum = nmr_spectrum(parsed.shieldings, "H", reference=31.5, width=0.05)
    assert len(spectrum.peaks) == 4
    assert spectrum.x.descending is True
    assert spectrum.peaks[0].x == pytest.approx(31.5 - 28.54643103)
    assert nmr_spectrum(parsed.shieldings, "C").peaks[0].label == "C1"


def test_tsv_import_sorts_and_keeps_every_row() -> None:
    spectrum = read_spectrum_file(FIXTURES / "sampleIRSpectra.tsv")
    assert spectrum.kind == "experimental"
    assert len(spectrum.x_values) == 400
    assert spectrum.x_values == sorted(spectrum.x_values)
    assert min(spectrum.y_values) > 0.0


def test_jcamp_dx_import_matches_the_header_metadata() -> None:
    spectrum = read_spectrum_file(FIXTURES / "methanol.jdx")
    assert spectrum.name == "METHANOL"
    assert spectrum.x.unit == "cm^-1" and spectrum.x.descending is True
    assert spectrum.y.label == "transmittance"
    # ##NPOINTS=3567, ##FIRSTX=463.438, ##LASTX=3806.57, ##FIRSTY=0.939
    assert len(spectrum.x_values) == 3567
    assert spectrum.x_values[0] == pytest.approx(463.438)
    assert spectrum.x_values[-1] == pytest.approx(3806.57, abs=0.01)
    assert spectrum.y_values[0] == pytest.approx(0.939)


def test_jcamp_dx_rejects_compressed_data_instead_of_guessing() -> None:
    text = "##TITLE=X\n##XYDATA=(X++(Y..Y))\n100.0 A1B2C3\n##END=\n"
    with pytest.raises(SpectraParseError, match="ASDF"):
        read_jcamp_dx(text)


def test_jcamp_dx_rejects_an_xy_table() -> None:
    with pytest.raises(SpectraParseError, match="unsupported"):
        read_jcamp_dx("##TITLE=X\n##XYDATA=(XY..XY)\n1.0, 2.0\n##END=\n")


def test_turbomole_uv_and_cd_files() -> None:
    uv = read_turbomole_spectrum((FIXTURES / "turbomole_spectrum").read_text())
    cd = read_turbomole_spectrum((FIXTURES / "turbomole_cdspectrum").read_text(), cd=True)
    assert len(uv) == len(cd) == 20
    assert uv[0].wavelength == pytest.approx(5177.1458833972)
    assert uv[0].oscillator_strength == pytest.approx(4.2605598200020e-05)
    assert uv[0].rotatory_strength is None
    assert cd[0].rotatory_strength == pytest.approx(24.551680696311)
    assert cd[1].rotatory_strength < 0  # the CD spectrum is signed
    spectrum = uvvis_spectrum(uv, width=20.0)
    assert spectrum.kind == "uvvis" and spectrum.x.unit == "nm"
    assert len(spectrum.peaks) == 20


def test_ir_spectrum_from_parsed_modes_is_plottable() -> None:
    parsed = read_orca_output(FIXTURES / "caffeine_orca.out")
    assert parsed.vibrations is not None
    spectrum = ir_spectrum(parsed.vibrations, width=15.0, shape="lorentzian")
    assert spectrum.kind == "ir"
    assert spectrum.x.descending is True
    assert spectrum.line_shape == "lorentzian" and spectrum.width == 15.0
    assert len(spectrum.peaks) == 72
    assert len(spectrum.x_values) == len(spectrum.y_values) == 1000
    assert max(spectrum.y_values) > 0.0
    # every stick keeps its index into the mode list so the UI can animate the clicked peak
    assert [p.source_index for p in spectrum.peaks] == list(range(72))


def test_ir_spectrum_transmittance_is_a_percentage() -> None:
    parsed = read_qchem_output(FIXTURES / "methane_qchem.out")
    assert parsed.vibrations is not None
    spectrum = ir_spectrum(parsed.vibrations, width=20.0, transmittance=True)
    assert spectrum.y.unit == "%"
    assert min(spectrum.y_values) >= 0.0 and max(spectrum.y_values) <= 100.0


def test_ir_spectrum_scale_factor_shifts_every_peak() -> None:
    parsed = read_qchem_output(FIXTURES / "methane_qchem.out")
    assert parsed.vibrations is not None
    plain = ir_spectrum(parsed.vibrations, width=20.0)
    scaled = ir_spectrum(parsed.vibrations, width=20.0, scale_factor=0.96)
    assert scaled.peaks[0].x == pytest.approx(plain.peaks[0].x * 0.96)
