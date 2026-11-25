# Solid C60 as cages

The same idealised fcc C60 as `../c60`, but each molecule's 60 carbons are one polyhedron: the truncated icosahedron, 12 pentagons and 20 hexagons. An invisible He atom at each molecule's centre (kept as the polyhedron's centre, never drawn) makes the cage. Every carbon is 3.51 Å from its centre; the next atom out is 6.55 Å away.

Source: generated with ASE, as in `../c60`: `ase.build.molecule("C60")` on the fcc sites of a cubic cell with a = 14.17 Å. The POSCAR also carries the He centre for each molecule.

Idealisation: all molecules share one orientation (the real room-temperature phase is orientationally disordered).

Licence: generated structure, no third-party data.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
