"""File format registry: read/write structures with ASE, RDKit or Open Babel."""

from atomscope.io.registry import (
    FormatInfo,
    formats,
    read_structure,
    structure_from_string,
    write_structure,
)

__all__ = [
    "FormatInfo",
    "formats",
    "read_structure",
    "structure_from_string",
    "write_structure",
]
