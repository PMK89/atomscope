# Plugin system

## Backend plugins (Python entry points, group `atomscope.backends`)

A backend plugin is a module exposing a `plugin` object implementing `BackendPlugin`:

```python
class BackendPlugin(Protocol):
    id: str                      # "cppaw"
    name: str                    # "CP-PAW"
    capabilities: BackendCapabilities   # what it can do: energy, forces, relax, md, orbitals, density, dos, bands ...
    def schema(self) -> ParameterSchema: ...              # parameter tree for the form engine
    def presets(self) -> list[Preset]: ...
    def validate(self, structure: Structure, params: ParameterValues) -> ValidationReport: ...
    def generate_inputs(self, structure, params, workdir_layout) -> GeneratedInputs: ...  # text files, deterministic
    def run_spec(self, generated: GeneratedInputs, resources: Resources) -> RunSpec: ... # argv, cwd, env, files to stream
    def parse_results(self, workdir: Path) -> ResultBundle: ...  # energies, forces, structures, trajectories, datasets
    def discover_executables(self) -> ExecutableReport: ...
```

Result data is expressed only in `atomscope.model` types, so the UI never sees backend-specific
structures. Additional plugin groups: `atomscope.formats` (file format readers/writers) and
`atomscope.analyses` (analysis providers).

## Implemented backend plugins

| id | executes | notes |
|---|---|---|
| `cppaw` | yes | flagship: schema, STRC/CNTL generation, driver, protocol/trajectory/cube parsing, MPI, restarts |
| `ase_builtin` | yes | ASE calculators (EMT/LJ/Morse, Open Babel force fields, CP-PAW forces via `CppawCalculator`) with BFGS/L-BFGS/FIRE and Langevin MD |
| `qc_inputs` | no | ORCA/Gaussian/NWChem/GAMESS-US/Quantum ESPRESSO/ABINIT input decks via ASE writers |
| `openbabel_ff` | yes | Open Babel force fields (feature branch) |

`BackendCapabilities.executes = False` marks input-generation-only plugins; the calculation service
refuses to run them and the UI offers the generated files for download instead.

## Frontend plugins

Editor tools register in `frontend/src/editor/tools/index.ts` and display layers are constructed
by the renderer; the general registry for panels and dataset renderers described in ADR 0004 has
not been built yet, so a frontend extension currently means editing those two lists.

## Rules

- Plugins never spawn processes; they return `RunSpec` and the JobManager executes it.
- Plugins never write outside the calculation work directory they are handed.
- Plugin schemas are data (JSON-serializable), so forms and validation are generic.
