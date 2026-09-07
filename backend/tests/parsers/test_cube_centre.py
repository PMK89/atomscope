"""Rolling a periodic grid so the thing it describes sits in the middle of it."""

import numpy as np
import pytest

from atomscope.parsers.cube import centre_on, grid_period

#: a cubic cell of 6 A with 6 points over 6 intervals, and the same with the plane repeated
STEP = 1.0
CELL = ((6.0, 0.0, 0.0), (0.0, 6.0, 0.0), (0.0, 0.0, 6.0))
AXES = ((STEP, 0.0, 0.0), (0.0, STEP, 0.0), (0.0, 0.0, STEP))


def test_period_comes_from_the_cell_not_from_the_values() -> None:
    # N points over N intervals
    assert grid_period((6, 6, 6), AXES, CELL) == (6, 6, 6)
    # N points over N-1 intervals: the boundary plane written twice, as paw_wave.x writes it
    assert grid_period((7, 7, 7), AXES, CELL) == (6, 6, 6)
    # a grid that is not this cell at all
    assert grid_period((5, 6, 6), AXES, CELL) is None
    assert grid_period((6, 6, 6), AXES, ((9.0, 0.0, 0.0), *CELL[1:])) is None


def _delta(shape: tuple[int, int, int], at: tuple[int, int, int]) -> np.ndarray:
    values = np.zeros(shape)
    values[at] = 1.0
    return values


@pytest.mark.parametrize("repeated", [False, True])
def test_a_peak_at_the_origin_ends_up_in_the_middle(repeated: bool) -> None:
    n = 7 if repeated else 6
    values = _delta((n, n, n), (0, 0, 0))
    if repeated:  # the duplicated planes carry the same value
        values[-1, :, :] = values[0, :, :]
        values[:, -1, :] = values[:, 0, :]
        values[:, :, -1] = values[:, :, 0]

    rolled, origin = centre_on(values, (0.0, 0.0, 0.0), AXES, (6, 6, 6), (0.0, 0.0, 0.0))

    assert rolled.shape == values.shape
    # nothing was created or destroyed: one peak, same height
    assert rolled.max() == pytest.approx(1.0)
    peak = np.unravel_index(np.argmax(rolled), rolled.shape)
    assert peak == (3, 3, 3)
    # ...and the world position of that peak is still (0,0,0), one cell over
    world = np.asarray(origin) + np.asarray(peak, dtype=float) * STEP
    assert world.tolist() == [0.0, 0.0, 0.0]
    if repeated:
        np.testing.assert_allclose(rolled[-1, :, :], rolled[0, :, :])


def test_the_field_is_unchanged_where_it_is_looked_up_in_world_space() -> None:
    rng = np.random.default_rng(7)
    values = rng.random((6, 6, 6))
    target = (1.5, 4.0, 0.5)
    rolled, origin = centre_on(values, (0.0, 0.0, 0.0), AXES, (6, 6, 6), target)

    # every voxel of the result holds the value the original had at the same place, wrapped
    for index in np.ndindex(6, 6, 6):
        world = np.asarray(origin) + np.asarray(index, dtype=float) * STEP
        old = tuple(int(round(w / STEP)) % 6 for w in world)
        assert rolled[index] == values[old]


def test_a_grid_already_centred_is_left_alone() -> None:
    values = _delta((6, 6, 6), (3, 3, 3))
    rolled, origin = centre_on(values, (0.0, 0.0, 0.0), AXES, (6, 6, 6), (3.0, 3.0, 3.0))
    np.testing.assert_array_equal(rolled, values)
    assert origin == (0.0, 0.0, 0.0)
