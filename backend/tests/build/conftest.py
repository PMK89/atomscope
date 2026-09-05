import pytest

from atomscope.io.rdkit_io import from_smiles
from atomscope.model import Structure


@pytest.fixture(scope="module")
def methane() -> Structure:
    return from_smiles("C")
