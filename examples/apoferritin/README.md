# Apoferritin 24-mer (PDB 1IER)

Horse spleen L-ferritin in its cubic form: the 24-chain biological assembly, protein atoms only, free-standing in a box cell with no periodic images. Its 33552 atoms take about 1.3 s to compile, the slowest example.

Source: RCSB PDB 1IER, biological assembly 1 (https://files.rcsb.org/download/1IER-assembly1.cif). Citation: Acta Cryst. D53, 580 (1997), "Comparison of the structures of the cubic and tetragonal forms of horse-spleen apoferritin".

Licence: wwPDB data is released under CC0 (public domain).

Changes:

- The ATOM records of model 1 are kept, altloc A only (altloc B is dropped). The HETATM records (waters and metal ions) are dropped.
- The source has no hydrogen atoms, so none are drawn.
- The atoms were read from the mmCIF with a small stdlib parser (ASE's CIF reader cannot read this file) and written as extxyz with ASE. The box cell is the bounding box plus 10 Å on each side, with no periodic boundaries.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
