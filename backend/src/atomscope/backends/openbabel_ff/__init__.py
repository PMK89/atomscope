"""Open Babel force fields (MMFF94, UFF, GAFF, Ghemical) as a backend plugin.

Like ``ase_builtin`` it runs in a subprocess (``python -m atomscope.backends.openbabel_ff.runner``)
so single points, optimizations and conformer searches are ordinary jobs with logs, cancellation
and result bundles.
"""

from atomscope.backends.openbabel_ff.plugin import plugin

__all__ = ["plugin"]
