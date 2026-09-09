"""Named surface slabs, their adsorption sites, and putting adsorbates on them.

The point of the named builders over the generic `crystal.build.slab` is the site names, so most
of what is checked here is that those names survive: into `Structure.surface`, through a save and
a reload, and into `ase.build.add_adsorbate` when an adsorbate is placed on one.
"""

from __future__ import annotations

import numpy as np
import pytest
from ase.build import fcc111 as ase_fcc111

from atomscope.ase_bridge import from_atoms, to_atoms
from atomscope.crystal import surfaces
from atomscope.crystal.build import bulk, slab
from atomscope.model import Structure


def cu111(size: tuple[int, int, int] = (2, 2, 3)) -> Structure:
    return surfaces.build("fcc111", "Cu", size, vacuum=6.0)


def test_every_builder_in_the_table_builds() -> None:
    """One element per lattice that ASE has a constant for; sizes the builders accept."""
    for kind, entry in surfaces.BUILDERS.items():
        size = (3, 3, 3) if kind == "fcc211" else (2, 2, 3)
        structure = surfaces.build(kind, surfaces.PROBE_SYMBOL[entry.lattice], size, vacuum=5.0)
        assert structure.n_atoms > 0, kind
        assert structure.cell is not None
        # a slab is periodic in the surface plane and not along the normal
        assert structure.cell.pbc == (True, True, False), kind


def test_the_facet_decides_the_site_names() -> None:
    """ASE's own names, and they differ from facet to facet -- that is the whole point."""
    assert sorted(cu111().surface.sites) == ["bridge", "fcc", "hcp", "ontop"]
    assert sorted(surfaces.build("fcc100", "Cu", (2, 2, 3)).surface.sites) == [
        "bridge",
        "hollow",
        "ontop",
    ]
    assert sorted(surfaces.build("fcc110", "Cu", (2, 2, 3)).surface.sites) == [
        "hollow",
        "longbridge",
        "ontop",
        "shortbridge",
    ]


def test_the_builder_list_reports_the_sites_and_the_options() -> None:
    listed = {k.id: k for k in surfaces.kinds()}
    assert set(listed) == set(surfaces.BUILDERS)
    assert listed["fcc111"].lattice == "fcc"
    assert listed["fcc111"].facet == "111"
    # the one the old letters-then-digits split got wrong: the `m` of 10m10 is a letter
    assert listed["hcp10m10"].lattice == "hcp"
    assert listed["hcp10m10"].facet == "10-10"
    assert listed["fcc111"].sites == ["bridge", "fcc", "hcp", "ontop"]
    assert listed["fcc111"].orthogonal_option
    assert not listed["fcc111"].takes_c
    # hcp is the lattice with a second constant, and fcc211 is orthogonal without a switch
    assert listed["hcp0001"].takes_c
    assert not listed["fcc211"].orthogonal_option


def test_the_sites_are_reported_in_the_surface_cell_and_in_angstrom() -> None:
    structure = cu111()
    found = {s.name: s for s in surfaces.sites(structure)}
    assert set(found) == {"bridge", "fcc", "hcp", "ontop"}
    assert found["ontop"].fractional == (0.0, 0.0)
    assert found["ontop"].cartesian == (0.0, 0.0)
    # the bridge site is half way along the first surface vector
    cell = np.array(structure.surface.cell)
    assert found["bridge"].cartesian == pytest.approx(tuple(0.5 * cell[0]))
    assert found["fcc"].fractional == pytest.approx((1 / 3, 1 / 3))


def test_a_generic_miller_slab_has_no_named_sites() -> None:
    """`build.slab` cuts any plane and cannot name the sites, so it reports none."""
    generic = slab(bulk("Cu", "fcc", cubic=True), (1, 1, 1), 3, vacuum=6.0)
    assert generic.surface is None
    assert surfaces.sites(generic) == []
    with pytest.raises(surfaces.SurfaceError, match="not built as a named surface"):
        surfaces.adsorb(generic, "O", 1.5, site="fcc")


def test_the_sites_survive_a_round_trip_through_json() -> None:
    """Saved and reloaded, a slab still knows its sites -- that is why they are a model field."""
    text = cu111().model_dump_json()
    back = Structure.model_validate_json(text)
    assert sorted(back.surface.sites) == ["bridge", "fcc", "hcp", "ontop"]
    # and ASE's own key is what the converter writes, so ase.build.add_adsorbate works on it
    atoms = to_atoms(back)
    assert "sites" in atoms.info["adsorbate_info"]
    assert sorted(atoms.info["adsorbate_info"]["sites"]) == ["bridge", "fcc", "hcp", "ontop"]


def test_an_atom_lands_above_the_named_site_at_the_height_asked_for() -> None:
    structure = cu111()
    top_z = max(a.position[2] for a in structure.atoms)
    with_o = surfaces.adsorb(structure, "O", 1.7, site="fcc")

    assert with_o.n_atoms == structure.n_atoms + 1
    added = with_o.atoms[-1]
    assert added.element == "O"
    assert added.position[2] == pytest.approx(top_z + 1.7)
    site = next(s for s in surfaces.sites(structure) if s.name == "fcc")
    assert (added.position[0], added.position[1]) == pytest.approx(site.cartesian)
    assert "fcc" in with_o.name and "O" in with_o.name


def test_a_second_adsorbate_is_not_stacked_on_the_first() -> None:
    """The height is measured from the slab, and stays measured from the slab.

    ASE works the reference atom out as the highest one and caches it in `adsorbate_info`; if
    `Structure.surface` did not carry `top layer atom index`, the second adsorbate would be
    placed above the first -- and a saved-and-reloaded slab would forget it.
    """
    one = surfaces.adsorb(cu111(), "O", 1.7, site="fcc")
    assert one.surface is not None and one.surface.top_layer_atom_index is not None
    # through JSON, exactly as the project store would
    reloaded = Structure.model_validate_json(one.model_dump_json())
    two = surfaces.adsorb(reloaded, "O", 1.7, site="hcp")
    zs = [a.position[2] for a in two.atoms if a.element == "O"]
    assert len(zs) == 2
    assert zs[0] == pytest.approx(zs[1])


def test_a_molecular_adsorbate_keeps_its_own_bonds() -> None:
    """`Atoms.extend` merges no bond information, so the bonds are re-perceived."""
    with_co = surfaces.adsorb(cu111(), "CO", 1.9, site="ontop")
    assert with_co.n_atoms == 14
    carbon, oxygen = (i for i, a in enumerate(with_co.atoms) if a.element in ("C", "O"))
    assert any(b.key() == (carbon, oxygen) for b in with_co.bonds)
    # and the uids are unique, which the per-atom lists of the slab alone would have broken
    assert len({a.uid for a in with_co.atoms}) == with_co.n_atoms


def test_an_adsorbate_can_be_another_structure() -> None:
    water = from_atoms(surfaces.resolve_adsorbate("H2O"), name="water")
    on_surface = surfaces.adsorb(cu111(), water, 2.2, site="ontop")
    assert on_surface.n_atoms == 12 + 3


def test_an_offset_moves_the_adsorbate_by_whole_surface_cells() -> None:
    structure = cu111()
    here = surfaces.adsorb(structure, "O", 1.7, site="ontop").atoms[-1].position
    there = surfaces.adsorb(structure, "O", 1.7, site="ontop", offset=(1, 0)).atoms[-1].position
    cell = np.array(structure.surface.cell)
    assert (there[0] - here[0], there[1] - here[1]) == pytest.approx(tuple(cell[0]))
    assert there[2] == pytest.approx(here[2])


def test_an_adsorbate_can_go_at_a_plain_position_too() -> None:
    structure = cu111()
    placed = surfaces.adsorb(structure, "O", 1.5, position=(1.0, 2.0))
    assert (placed.atoms[-1].position[0], placed.atoms[-1].position[1]) == pytest.approx((1.0, 2.0))
    with pytest.raises(surfaces.SurfaceError, match="not both"):
        surfaces.adsorb(structure, "O", 1.5, site="fcc", position=(1.0, 2.0))
    with pytest.raises(surfaces.SurfaceError, match="named site or an x-y position"):
        surfaces.adsorb(structure, "O", 1.5)


def test_an_unknown_site_names_the_ones_there_are() -> None:
    with pytest.raises(surfaces.SurfaceError, match="bridge, fcc, hcp, ontop"):
        surfaces.adsorb(cu111(), "O", 1.5, site="hollow")


def test_an_element_symbol_wins_over_a_molecule_name() -> None:
    """'C' is both carbon and one of ASE's molecule names; on a surface it means the atom."""
    assert len(surfaces.resolve_adsorbate("C")) == 1
    assert surfaces.resolve_adsorbate("CO").get_chemical_formula() == "CO"
    assert len(surfaces.resolve_adsorbate("CH4")) == 5
    with pytest.raises(surfaces.SurfaceError, match="neither an element symbol"):
        surfaces.resolve_adsorbate("unobtainium")


def test_bad_arguments_are_refused_with_the_reason() -> None:
    with pytest.raises(surfaces.SurfaceError, match="unknown surface builder"):
        surfaces.build("fcc112", "Cu", (2, 2, 3))
    with pytest.raises(surfaces.SurfaceError, match="three positive integers"):
        surfaces.build("fcc111", "Cu", (2, 0, 3))
    # aluminium has no tabulated bcc constant, and ASE's own message says so
    with pytest.raises(surfaces.SurfaceError, match="lattice constant"):
        surfaces.build("bcc110", "Al", (2, 2, 3))
    with pytest.raises(surfaces.SurfaceError, match="no second lattice constant"):
        surfaces.build("fcc111", "Cu", (2, 2, 3), c=5.0)
    with pytest.raises(surfaces.SurfaceError, match="no orthogonal option"):
        surfaces.build("fcc100", "Cu", (2, 2, 3), orthogonal=True)


def test_the_lattice_constants_reach_the_builder() -> None:
    # with a vacuum, so the cell has a third vector and therefore a volume
    wide = surfaces.build("fcc111", "Cu", (1, 1, 2), a=4.0, vacuum=5.0)
    narrow = surfaces.build("fcc111", "Cu", (1, 1, 2), a=3.5, vacuum=5.0)
    assert wide.cell.volume() > narrow.cell.volume()
    tall = surfaces.build("hcp0001", "Ti", (1, 1, 2), a=3.0, c=5.0, vacuum=5.0)
    assert tall.n_atoms == 2


def test_orthogonal_squares_the_surface_cell() -> None:
    # with a vacuum: without one ASE leaves the third cell vector at zero, and the angles
    # against it are then NaN rather than anything to assert on
    slanted = surfaces.build("fcc111", "Cu", (2, 2, 3), orthogonal=False, vacuum=5.0)
    square = surfaces.build("fcc111", "Cu", (2, 2, 3), orthogonal=True, vacuum=5.0)
    _lengths, angles = square.cell.lengths_angles()
    assert angles[2] == pytest.approx(90.0)
    assert slanted.cell.lengths_angles()[1][2] != pytest.approx(90.0)


def test_vacuum_is_added_above_an_existing_slab() -> None:
    structure = cu111()
    before = structure.cell.volume()
    taller = surfaces.with_vacuum(structure, 5.0)
    assert taller.cell.volume() > before
    assert taller.n_atoms == structure.n_atoms
    with pytest.raises(surfaces.SurfaceError, match="must be positive"):
        surfaces.with_vacuum(structure, 0.0)


def test_a_slab_ase_built_directly_is_read_the_same_way() -> None:
    """A script that calls `ase.build.fcc111` itself and saves it keeps its sites."""
    structure = from_atoms(ase_fcc111("Ag", size=(2, 2, 3), vacuum=5.0), name="ag111")
    assert structure.surface is not None
    assert sorted(structure.surface.sites) == ["bridge", "fcc", "hcp", "ontop"]
