"""What a script can do, in the smallest form that shows each part.

`atoms` is predefined: the structure that was selected when Run was pressed, as an
``ase.Atoms``. Everything in the project's environment is importable -- ASE, numpy, scipy and
Atomscope itself. `save` hands a structure back to the project, `value` a named number or string
to the Scripts panel, and anything printed appears in the output pane.
"""

import numpy as np

from atomscope.scripting import save, value

print(f"{atoms.get_chemical_formula()}: {len(atoms)} atoms")  # noqa: F821

value("formula", atoms.get_chemical_formula())  # noqa: F821
value("centre of mass", atoms.get_center_of_mass())  # noqa: F821
if len(atoms) > 1:  # noqa: F821
    d = atoms.get_all_distances()  # noqa: F821
    value("largest separation / A", np.max(d))

# a structure moved to its centre of mass, saved as a second structure of the project
centred = atoms.copy()  # noqa: F821
centred.translate(-atoms.get_center_of_mass())  # noqa: F821
save(centred, name=f"{atoms.get_chemical_formula()} centred")  # noqa: F821
