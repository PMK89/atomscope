"""Two-column spectral data files: TSV/CSV, JCAMP-DX and the Turbomole spectrum files.

These are the formats Avogadro 1's spectra dialog can import
(``libavogadro/src/extensions/spectra/spectradialog.cpp:512-604``), so that a measured spectrum
can be overlaid on a computed one.

**TSV / CSV** -- two numeric columns, separator auto-detected from tab, comma or semicolon;
``#`` comment lines and a non-numeric header row are skipped. Example
(``sampleIRSpectra.tsv``)::

    3998.27344	0.99535
    3997.30908	0.99406

**JCAMP-DX** (``methanol.jdx``) -- labelled data records followed by ``##XYDATA=(X++(Y..Y))``,
one abscissa followed by a run of ordinates per line::

    ##XUNITS=1/CM
    ##YUNITS=TRANSMITTANCE
    ##XFACTOR=1.000000
    ##YFACTOR=1
    ##DELTAX=0.937503
    ##XYDATA=(X++(Y..Y))
    463.438000 0.9390 0.9400 0.9400 0.9400 0.9400

Only the plain AFFN encoding is read -- values separated by spaces, as in every file of the
Avogadro corpus. The ASDF compressions (SQZ/DIF/DUP, i.e. digits encoded as ``A-I``/``a-i``,
``J-R``/``j-r``, ``S-Z``) are **not** decoded; a file using them raises
:class:`SpectraParseError` rather than returning silently wrong numbers. ``(XY..XY)`` tables are
likewise out of scope.

**Turbomole** ``spectrum`` / ``cdspectrum`` -- two columns after ``#`` comment lines, wavelength
in nm against oscillator strength (UV-Vis) or rotatory strength (CD)::

    # Electronic excitation spectrum of TmoleXProject, IRREP a
    #  excitation energy / nm  oscillator strength (length rep.)
     0.51771458833972E+04   0.42605598200020E-04
"""

from __future__ import annotations

import re
from pathlib import Path

from atomscope.model import (
    ElectronicTransition,
    Provenance,
    Spectrum,
    SpectrumAxis,
    SpectrumKind,
    new_uid,
)
from atomscope.parsers.spectra_common import SpectraParseError

LABEL = re.compile(r"^##(\$?[^=]+)=(.*)$")
NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$")
ASDF = re.compile(r"[A-IJ-Ra-ij-rS-Zs%]")

JCAMP_X_UNITS = {"1/CM": "cm^-1", "MICROMETERS": "um", "NANOMETERS": "nm", "SECONDS": "s"}
JCAMP_Y_UNITS = {
    "TRANSMITTANCE": "%",
    "ABSORBANCE": "",
    "ARBITRARY UNITS": "",
    "KUBELKA-MUNK": "",
}


def _to_float(token: str) -> float:
    return float(token.replace("D", "E").replace("d", "e"))


def _columns(text: str) -> tuple[list[float], list[float]]:
    """Two numeric columns from a delimited text file; header and comment lines are skipped."""
    x: list[float] = []
    y: list[float] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", "!", "%")):
            continue
        for sep in ("\t", ";", ",", None):
            parts = line.split(sep) if sep else line.split()
            if len(parts) >= 2:
                break
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) < 2 or not NUMBER.match(parts[0]) or not NUMBER.match(parts[1]):
            continue
        x.append(_to_float(parts[0]))
        y.append(_to_float(parts[1]))
    if not x:
        msg = "no two-column numeric data found"
        raise SpectraParseError(msg)
    return x, y


def read_xy_spectrum(
    text: str,
    *,
    name: str,
    kind: SpectrumKind = "experimental",
    x_label: str = "x",
    x_unit: str = "",
    y_label: str = "y",
    y_unit: str = "",
    descending: bool = False,
) -> Spectrum:
    """A TSV/CSV two-column spectrum with caller-supplied axis metadata."""
    x, y = _columns(text)
    order = sorted(range(len(x)), key=lambda i: x[i])
    return Spectrum(
        id=new_uid(),
        kind=kind,
        name=name,
        x=SpectrumAxis(label=x_label, unit=x_unit, descending=descending),
        y=SpectrumAxis(label=y_label, unit=y_unit),
        x_values=[x[i] for i in order],
        y_values=[y[i] for i in order],
        provenance=Provenance(source=name, notes="imported spectrum"),
    )


def read_jcamp_dx(text: str, *, name: str = "JCAMP-DX") -> Spectrum:
    """Read a JCAMP-DX ``(X++(Y..Y))`` block (AFFN encoding only)."""
    labels: dict[str, str] = {}
    data: list[str] = []
    in_data = False
    for raw in text.splitlines():
        line = raw.rstrip()
        m = LABEL.match(line.strip())
        if m:
            key = m.group(1).strip().upper()
            value = m.group(2).strip()
            labels[key] = value
            if key == "XYDATA":
                if "X++" not in value.replace(" ", ""):
                    msg = f"unsupported JCAMP-DX data form {value!r}; only (X++(Y..Y)) is read"
                    raise SpectraParseError(msg)
                in_data = True
            elif key == "END":
                in_data = False
            continue
        if in_data and line.strip():
            data.append(line)
    if not data:
        msg = "no ##XYDATA=(X++(Y..Y)) block found"
        raise SpectraParseError(msg)
    x_factor = float(labels.get("XFACTOR", "1"))
    y_factor = float(labels.get("YFACTOR", "1"))
    delta = float(labels["DELTAX"]) if "DELTAX" in labels else None
    x: list[float] = []
    y: list[float] = []
    for line in data:
        if ASDF.search(line):
            msg = "this JCAMP-DX file uses ASDF (SQZ/DIF/DUP) compression, which is not decoded"
            raise SpectraParseError(msg)
        tokens = line.split()
        if len(tokens) < 2:
            continue
        x0 = _to_float(tokens[0]) * x_factor
        ordinates = [_to_float(t) * y_factor for t in tokens[1:]]
        step = delta * x_factor if delta is not None else 0.0
        for i, value in enumerate(ordinates):
            x.append(x0 + i * step)
            y.append(value)
    x_unit = JCAMP_X_UNITS.get(labels.get("XUNITS", "").upper(), labels.get("XUNITS", ""))
    y_label = labels.get("YUNITS", "intensity").lower()
    y_unit = JCAMP_Y_UNITS.get(labels.get("YUNITS", "").upper(), "")
    return Spectrum(
        id=new_uid(),
        kind="experimental",
        name=labels.get("TITLE", name),
        x=SpectrumAxis(label="wavenumber", unit=x_unit, descending=x_unit == "cm^-1"),
        y=SpectrumAxis(label=y_label, unit=y_unit),
        x_values=x,
        y_values=y,
        provenance=Provenance(
            source=name, software=labels.get("ORIGIN"), notes=labels.get("DATA TYPE", "")
        ),
    )


def read_turbomole_spectrum(text: str, *, cd: bool = False) -> list[ElectronicTransition]:
    """Turbomole ``spectrum`` (UV-Vis) or ``cdspectrum`` (CD): wavelength in nm vs strength."""
    x, y = _columns(text)
    return [
        ElectronicTransition(
            wavelength=xi,
            oscillator_strength=None if cd else yi,
            rotatory_strength=yi if cd else None,
        )
        for xi, yi in zip(x, y, strict=True)
    ]


def read_spectrum_file(path: Path, *, kind: SpectrumKind = "experimental") -> Spectrum:
    """Import a spectrum by extension: ``.jdx``/``.dx``/``.jcamp`` as JCAMP-DX, else TSV/CSV."""
    text = path.read_text(errors="replace")
    if path.suffix.lower() in (".jdx", ".dx", ".jcamp"):
        return read_jcamp_dx(text, name=path.name)
    if text.lstrip().startswith("##TITLE"):
        return read_jcamp_dx(text, name=path.name)
    return read_xy_spectrum(text, name=path.name, kind=kind)


__all__ = [
    "read_jcamp_dx",
    "read_spectrum_file",
    "read_turbomole_spectrum",
    "read_xy_spectrum",
]
