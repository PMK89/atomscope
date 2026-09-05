"""ASE built-in calculators (EMT, Lennard-Jones, Morse) as a backend plugin.

Runs as a separate process (``python -m atomscope.backends.ase_builtin.runner``) so that jobs are
handled exactly like external codes: same JobManager, streaming, cancellation and result files.
Useful as a zero-dependency demonstration backend and for testing the generic machinery.
"""

from atomscope.backends.ase_builtin.plugin import plugin

__all__ = ["plugin"]
