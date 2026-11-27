# GLUT1 (PDB 4PYP)

The human glucose transporter GLUT1, protein atoms only, free-standing in a box cell with no periodic images. Its 3469 atoms take about 0.1 s to compile.

Source: RCSB PDB 4PYP (https://files.rcsb.org/download/4PYP.cif), "Crystal structure of the human glucose transporter GLUT1". The primary citation is in the entry's mmCIF file (https://www.rcsb.org/structure/4PYP).

Licence: wwPDB data is released under CC0 (public domain).

Changes:

- The ATOM records of model 1 are kept. The HETATM records (21: ligands and waters) are dropped.
- The source has no hydrogen atoms, so none are drawn.
- The atoms were read from the mmCIF with a small stdlib parser and written as extxyz with ASE. The box cell is the bounding box plus 8 Å on each side, with no periodic boundaries.

The config also draws the flat rings of C and N, the aromatic side chains (Phe, Tyr, Trp, His): 64 rings (54 six-membered, 10 five-membered) as filled faces.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
