"""The Python scripting subsystem.

Only the script-facing API is re-exported here, so that ``from atomscope.scripting import save``
in a user script does not drag in the service, the project store or the job manager. The service
lives in :mod:`atomscope.scripting.service` and the child process entry point in
:mod:`atomscope.scripting.runner`.
"""

from atomscope.scripting.api import (
    RunContext,
    ScriptApiError,
    input_atoms,
    list_structures,
    load,
    save,
    value,
)

__all__ = [
    "RunContext",
    "ScriptApiError",
    "input_atoms",
    "list_structures",
    "load",
    "save",
    "value",
]
