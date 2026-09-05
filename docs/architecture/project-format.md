# Project format

A project is a directory. Everything a user needs to reopen and continue work is inside it;
nothing depends on frontend state.

```text
<project>/
  project.json                 ProjectManifest: id, name, format_version, created, structure ids,
                               calculation ids, notes, view settings
  structures/<id>.json         Structure documents (atomscope.model.Structure)
  calculations/<calc-id>/
    calculation.json           Calculation: backend id, parameter values, structure id,
                               status history, job record (argv, cwd, pid, timestamps, exit code)
    input/                     generated input files exactly as sent to the code
    work/                      working directory of the executed job (raw outputs, logs)
    results/                   parsed results: results.json (ResultBundle) plus binary sidecars
                               <grid-id>.f32 for volumetric grids referenced by data_ref
  datasets/<id>.json           standalone imported datasets (cube files, trajectories, spectra)
  datasets/<id>.bin            binary sidecars for datasets
  presets/<name>.json          saved parameter presets
```

Rules:

- `format_version` is an integer; loaders migrate older versions forward.
- JSON is written with sorted keys and two-space indentation via pydantic, so diffs are readable
  and identical content produces identical bytes.
- Binary sidecars are little-endian, C-order, with dtype and shape given by the referencing JSON.
- Ids are short random hex strings; names are free text.
- Raw output directories are never rewritten by parsers; parsed data goes to `results/`.
- A project can be zipped and moved; all references are relative paths.
