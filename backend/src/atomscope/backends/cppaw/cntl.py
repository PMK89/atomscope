"""Generate CP-PAW control files (``!CONTROL``) from task-oriented parameter values."""

from __future__ import annotations

from atomscope.backends.cppaw.deck import Block, format_deck

Values = dict[str, object]


def _f(v: Values, key: str, default: float) -> float:
    x = v.get(key, default)
    return float(x) if isinstance(x, int | float) else default


def _i(v: Values, key: str, default: int) -> int:
    x = v.get(key, default)
    return int(x) if isinstance(x, int | float) and not isinstance(x, bool) else default


def _b(v: Values, key: str, default: bool) -> bool:
    x = v.get(key, default)
    return bool(x) if x is not None else default


def orbital_band_list(text: object) -> list[int]:
    if not isinstance(text, str):
        return []
    return [
        int(t)
        for t in text.replace(",", " ").split()
        if t.strip().lstrip("-").isdigit() and int(t) > 0
    ]


def analysis_files(root_name: str, v: Values) -> list[tuple[str, str]]:
    """(kind, wave file name) pairs the CNTL will request; used by the driver to make cubes."""
    out: list[tuple[str, str]] = []
    if _b(v, "write_density", False):
        out.append(("electron_density", f"{root_name}_density.wv"))
    if _b(v, "write_spin_density", False) and _b(v, "spin_polarized", False):
        out.append(("spin_density", f"{root_name}_spin.wv"))
    for band in orbital_band_list(v.get("orbital_bands", "")):
        out.append((f"orbital:{band}", f"{root_name}_b{band}.wv"))
    return out


def force_stage_values(v: Values) -> Values:
    """Second stage of the 'forces' task: continue from the converged restart file and
    propagate the atoms for a few damped steps so that the protocol reports forces."""
    stage = dict(v)
    stage["task"] = "_force_stage"
    stage["start"] = "restart"
    stage["nstep"] = _i(v, "force_steps", 5)
    stage["nwrite"] = 1
    return stage


def build_cntl(root_name: str, v: Values) -> Block:  # noqa: PLR0912, PLR0915
    task = str(v.get("task", "single_point"))
    start = str(v.get("start", "scratch"))
    if task == "forces":
        # Stage 1 of the forces task is a plain wave-function optimization (see force_stage_values).
        task = "single_point"
    root = Block("__ROOT__")
    ctl = Block("CONTROL")
    root.children.append(ctl)

    gen = ctl.ensure_child("GENERIC")
    gen.set("START", start == "scratch")
    if start == "restart_new_structure":
        gen.set("NEWSTRC", True)
    gen.set("NSTEP", _i(v, "nstep", 300))
    gen.set("DT", _f(v, "dt", 5.0))
    gen.set("NWRITE", _i(v, "nwrite", 50))
    gen.set("ETOL", _f(v, "etol", 1e-5))
    gen.set("AUTOCONV", _i(v, "autoconv", 20))

    dft = ctl.ensure_child("DFT")
    dft.set("TYPE", _i(v, "xc", 10))
    if _b(v, "vdw", False):
        dft.set("VDW", True)

    fourier = ctl.ensure_child("FOURIER")
    fourier.set("EPWPSI", _f(v, "epwpsi", 30.0))
    fourier.set("CDUAL", _f(v, "cdual", 2.0))

    psi = ctl.ensure_child("PSIDYN")
    psi.set("STOP", True)
    psi.set("FRIC", _f(v, "psi_friction", 0.05))
    psi.set("SAFEORTHO", _b(v, "safeortho", True) and v.get("occupations") != "mermin")
    if task == "md":
        psi.set("FRIC", 0.0)
        if _b(v, "psi_thermostat", True):
            th = psi.ensure_child("THERMOSTAT")
            th.set("FREQ[THZ]", 100.0)
            th.set("FRIC", 0.1)
            th.set("STOP", True)
    elif task == "_force_stage":
        psi.set("FRIC", max(_f(v, "psi_friction", 0.05), 0.05))
    elif _b(v, "psi_auto", True):
        auto = psi.ensure_child("AUTO")
        auto.set("FRIC(-)", _f(v, "psi_auto_fric_minus", 0.3))
        auto.set("FACT(-)", _f(v, "psi_auto_fact_minus", 0.97))
        auto.set("FRIC(+)", _f(v, "psi_auto_fric_plus", 0.3))
        auto.set("FACT(+)", 1.0)
        auto.set("MINFRIC", _f(v, "psi_auto_minfric", 0.01))

    if task in ("_force_stage", "relax", "md"):
        rdyn = ctl.ensure_child("RDYN")
        rdyn.set("STOP", True)
        if task == "_force_stage":
            rdyn.set("FRIC", 1.0)  # steepest descent: atoms barely move during the few steps
        elif task == "relax":
            rdyn.set("FRIC", _f(v, "atom_friction", 0.1))
            if _b(v, "atom_auto", True):
                auto = rdyn.ensure_child("AUTO")
                auto.set("FRIC(-)", 0.0)
                auto.set("FACT(-)", 1.0)
                auto.set("FRIC(+)", 0.01)
                auto.set("FACT(+)", 1.0)
        else:
            rdyn.set("FRIC", 0.0)
            rnd = _f(v, "random_velocities", 0.0)
            if rnd > 0:
                rdyn.set("RANDOM[K]", rnd)
            if _b(v, "thermostat", True):
                th = rdyn.ensure_child("THERMOSTAT")
                th.set("T[K]", _f(v, "temperature", 300.0))
                th.set("FREQ[THZ]", _f(v, "thermostat_freq", 10.0))
                th.set("FRIC", 0.0)
                th.set("STOP", True)

    if v.get("occupations") == "mermin":
        mer = ctl.ensure_child("MERMIN")
        mer.set("START", start == "scratch")
        mer.set("T[K]", _f(v, "electron_temperature", 1000.0))
        mer.set("ADIABATIC", True)
        mer.set("RETARD", _f(v, "mermin_retard", 10.0))
        mer.set("TETRA+", True)
        mer.set("STOP", True)

    ana = ctl.ensure_child("ANALYSE")
    tra = ana.ensure_child("TRA")
    tra.set("R", True)
    tra.set("E", _b(v, "energy_trajectory", True))
    dr = _f(v, "grid_spacing", 0.4)
    for kind, fname in analysis_files(root_name, v):
        if kind.startswith("orbital:"):
            w = Block("WAVE")
            w.set("TITLE", f"band {kind.split(':')[1]}")
            w.set("FILE", fname)
            w.set("B", int(kind.split(":")[1]))
            w.set("K", 1)
            w.set("S", 1)
            w.set("DR", dr)
            ana.children.append(w)
        else:
            d = Block("DENSITY")
            d.set("TITLE", kind.replace("_", " "))
            d.set("FILE", fname)
            d.set("TYPE", "SPIN" if kind == "spin_density" else "TOTAL")
            d.set("DR", dr)
            ana.children.append(d)
    return root


def cntl_text(root_name: str, v: Values) -> str:
    return format_deck(build_cntl(root_name, v))


def wcntl_text(
    root_name: str,
    wave_file: str,
    cube_file: str,
    origin_bohr: tuple[float, float, float],
    box_bohr: tuple[
        tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]
    ],
) -> str:
    """Control file for ``paw_wave.x``: view box in Bohr, cube output; the large DX file is
    suppressed."""
    root = Block("__ROOT__")
    w = Block("WCNTL")
    root.children.append(w)
    files = w.ensure_child("FILES")
    for fid, name in (
        ("STRC", f"{root_name}.strc_out"),
        ("WAVE", wave_file),
        ("CUBE", cube_file),
        # The .wrl (VRML) output cannot be redirected: paw_wave validates the ID 'WRL' but its
        # file handler registers 'VRML', so we let the small .wrl be written.
        ("WAVEDX", "/dev/null"),
    ):
        f = Block("FILE")
        f.set("ID", fid)
        f.set("EXT", False)
        f.set("NAME", name)
        files.children.append(f)
    vb = w.ensure_child("VIEWBOX")
    vb.set("O", list(origin_bohr))
    vb.set("T", [float(x) for row in box_bohr for x in row])  # three edge vectors
    return format_deck(root)
