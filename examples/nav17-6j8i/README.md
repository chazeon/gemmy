# Nav1.7 (PDB 6J8I)

The human voltage-gated sodium channel Nav1.7 with its auxiliary beta subunits, bound to the toxins ProTx-II and tetrodotoxin (the Y1755-up state in the entry's title). Protein atoms only, free-standing in a box cell with no periodic images. Its 11588 atoms take about 0.5 s to compile.

Source: RCSB PDB 6J8I (https://files.rcsb.org/download/6J8I.cif), "Structure of human voltage-gated sodium channel Nav1.7 in complex with auxiliary beta subunits, ProTx-II and tetrodotoxin (Y1755 up)". The primary citation is in the entry's mmCIF file (https://www.rcsb.org/structure/6J8I).

Licence: wwPDB data is released under CC0 (public domain).

Changes:

- The ATOM records of model 1 are kept. The HETATM records (176: ligands, lipids, glycans and tetrodotoxin) are dropped.
- The source has no hydrogen atoms, so none are drawn.
- The atoms were read from the mmCIF with a small stdlib parser and written as extxyz with ASE. The box cell is the bounding box plus 8 Å on each side, with no periodic boundaries.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
