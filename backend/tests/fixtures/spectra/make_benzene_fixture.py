"""Regenerate ``benzene_freq.g03``, a synthetic Gaussian frequency section for benzene.

Run from anywhere: ``python backend/tests/fixtures/spectra/make_benzene_fixture.py``.

The Avogadro 1 test corpus has no Gaussian ``freq=`` job for benzene (``testfiles/benzene.g03``
is an optimisation), so this fixture is written here to exercise the parser on a full
``3N-6 = 30`` mode set with D6h symmetry labels. Frequencies are the gas-phase experimental
fundamentals and the IR-active modes are exactly A2u + 3 x E1u (7 of 30); the displacement
vectors are deterministic pseudo-random unit vectors, **not** physical normal coordinates.
Output is byte-identical on every run (fixed RNG seed), so regenerating it produces no diff.
"""

from pathlib import Path

import numpy as np

MODES = [
    (398.0, "E2U", 0.0),
    (398.0, "E2U", 0.0),
    (606.0, "E2G", 0.0),
    (606.0, "E2G", 0.0),
    (674.0, "A2U", 74.5),
    (707.0, "B2G", 0.0),
    (846.0, "E1G", 0.0),
    (846.0, "E1G", 0.0),
    (967.0, "E2U", 0.0),
    (967.0, "E2U", 0.0),
    (990.0, "B2G", 0.0),
    (993.0, "A1G", 0.0),
    (1010.0, "B1U", 0.0),
    (1038.0, "E1U", 6.2),
    (1038.0, "E1U", 6.2),
    (1150.0, "B2U", 0.0),
    (1178.0, "E2G", 0.0),
    (1178.0, "E2G", 0.0),
    (1309.0, "B2U", 0.0),
    (1350.0, "A2G", 0.0),
    (1484.0, "E1U", 12.8),
    (1484.0, "E1U", 12.8),
    (1599.0, "E2G", 0.0),
    (1599.0, "E2G", 0.0),
    (3056.0, "E2G", 0.0),
    (3056.0, "E2G", 0.0),
    (3057.0, "B1U", 0.0),
    (3064.0, "E1U", 40.1),
    (3064.0, "E1U", 40.1),
    (3073.0, "A1G", 0.0),
]
N = 12
RCC, RCH = 1.3970, 1.0870
symbols, numbers, coords = [], [], []
for i in range(6):
    a = np.pi / 3 * i
    coords.append((RCC * np.cos(a), RCC * np.sin(a), 0.0))
    numbers.append(6)
for i in range(6):
    a = np.pi / 3 * i
    r = RCC + RCH
    coords.append((r * np.cos(a), r * np.sin(a), 0.0))
    numbers.append(1)

rng = np.random.default_rng(20260905)
raw = rng.standard_normal((30, 3 * N))
q, _ = np.linalg.qr(raw.T)
vectors = np.round(q.T[:30].reshape(30, N, 3), 2)

lines = [
    " Synthetic Gaussian frequency output for benzene; see PROVENANCE.md. The geometry is an",
    " idealised D6h ring and the displacement vectors are deterministic pseudo-random unit",
    " vectors -- only the file layout and the frequency/intensity/symmetry values are meaningful.",
    "",
    "                          Standard orientation:                          ",
    " ---------------------------------------------------------------------",
    " Center     Atomic     Atomic              Coordinates (Angstroms)",
    " Number     Number      Type              X           Y           Z",
    " ---------------------------------------------------------------------",
]
for i, (z, p) in enumerate(zip(numbers, coords, strict=True), start=1):
    lines.append(f"{i:5d}{z:11d}{0:14d}{p[0]:16.6f}{p[1]:12.6f}{p[2]:12.6f}")
lines += [
    " ---------------------------------------------------------------------",
    " Harmonic frequencies (cm**-1), IR intensities (KM/Mole), Raman scattering",
    " activities (A**4/AMU), depolarization ratios for plane and unpolarized",
    " incident light, reduced masses (AMU), force constants (mDyne/A),",
    " and normal coordinates:",
]
for start in range(0, 30, 3):
    block = MODES[start : start + 3]
    lines.append("".join(f"{start + j + 1:23d}" for j in range(len(block))))
    lines.append("".join(f"{m[1]:>23s}" for m in block))
    lines.append(" Frequencies --" + "".join(f"{m[0]:11.4f}           " for m in block))
    lines.append(
        " Red. masses --"
        + "".join(f"{1.0 + 0.1 * (j % 3):11.4f}           " for j, _ in enumerate(block))
    )
    lines.append(" Frc consts  --" + "".join(f"{1.0:11.4f}           " for _ in block))
    lines.append(" IR Inten    --" + "".join(f"{m[2]:11.4f}           " for m in block))
    lines.append(
        " Raman Activ --"
        + "".join(f"{(k + 1) * 1.5:11.4f}           " for k, m in enumerate(block))
    )
    lines.append(" Atom AN      X      Y      Z" + "        X      Y      Z" * (len(block) - 1))
    for a in range(N):
        row = f"{a + 1:4d}{numbers[a]:4d}"
        for j in range(len(block)):
            v = vectors[start + j][a]
            row += f"{v[0]:7.2f}{v[1]:7.2f}{v[2]:7.2f}"
        lines.append(row)
zpe = 0.5 * sum(m[0] for m in MODES) * 0.0001239841984
lines += [
    "",
    " -------------------",
    " - Thermochemistry -",
    " -------------------",
    f" Zero-point vibrational energy     {zpe * 96.485 * 1000:.1f} (Joules/Mol)",
    "",
]
out = Path(__file__).with_name("benzene_freq.g03")
out.write_text("\n".join(lines) + "\n")
print(f"wrote {out} ({len(MODES)} modes, {sum(1 for m in MODES if m[2] > 0)} IR active)")
