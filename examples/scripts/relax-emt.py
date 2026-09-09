"""Relax the selected structure with ASE's EMT calculator and save the result.

EMT is a cheap effective-medium potential for a handful of metals, which makes it the right
calculator for trying a script out: no input files, no waiting. Swap the two lines marked below
for another ASE calculator and the rest of the script is unchanged.
"""

from ase.calculators.emt import EMT
from ase.optimize import BFGS

from atomscope.scripting import save, value

relaxed = atoms.copy()  # noqa: F821
relaxed.calc = EMT()  # <- the calculator
value("energy before / eV", relaxed.get_potential_energy())

optimiser = BFGS(relaxed, logfile="-")  # '-' so the steps appear in the output pane
optimiser.run(fmax=0.05)

value("energy after / eV", relaxed.get_potential_energy())
value("steps", optimiser.get_number_of_steps())
save(relaxed, name=f"{relaxed.get_chemical_formula()} relaxed (EMT)")
