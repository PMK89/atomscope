import pytest
from pydantic import ValidationError

from atomscope.model import Frame, OrbitalInfo, Trajectory, VolumetricGrid
from atomscope.units import Unit


def test_grid_requires_exactly_one_storage() -> None:
    kwargs = dict(
        id="g1",
        name="density",
        origin=(0.0, 0.0, 0.0),
        axes=((0.1, 0, 0), (0, 0.1, 0), (0, 0, 0.1)),
        shape=(2, 2, 2),
        unit=Unit.E_PER_ANGSTROM3,
    )
    with pytest.raises(ValidationError, match="exactly one"):
        VolumetricGrid(**kwargs)
    with pytest.raises(ValidationError, match="exactly one"):
        VolumetricGrid(**kwargs, data_ref="a.bin", inline_values=[0.0] * 8)
    g = VolumetricGrid(**kwargs, inline_values=[0.0] * 8, kind="electron_density")
    assert g.n_points == 8
    with pytest.raises(ValidationError, match="entries"):
        VolumetricGrid(**kwargs, inline_values=[0.0] * 7)


def test_orbital_metadata() -> None:
    o = OrbitalInfo(index=4, energy=-6.2, occupation=2.0, spin="none", label="HOMO")
    assert o.model_dump()["label"] == "HOMO"


def test_trajectory_frame_consistency() -> None:
    t = Trajectory(id="t", name="opt", symbols=["H", "H"], kind="optimization")
    t.frames.append(Frame(positions=[(0, 0, 0), (0.74, 0, 0)], energy=-1.0))
    assert Trajectory.model_validate(t.model_dump()).n_frames == 1
    with pytest.raises(ValidationError, match="expected 2"):
        Trajectory(id="t", name="x", symbols=["H", "H"], frames=[Frame(positions=[(0, 0, 0)])])
    with pytest.raises(ValidationError, match="forces"):
        Frame(positions=[(0, 0, 0), (1, 0, 0)], forces=[(0, 0, 0)])
