# Solid C60 (fullerite)

Solid C60 with an fcc lattice, four molecules per conventional cell, drawn as ball-and-stick: each molecule's bonds are shown, so every molecule is whole. The 2x2x2 supercell has 32 molecules (1920 atoms).

Source: one C60 molecule from `ase.build.molecule("C60")`, placed on the fcc sites (0,0,0), (0,1/2,1/2), (1/2,0,1/2) and (1/2,1/2,0) of a cubic cell with a = 14.17 Å. The lattice constant is a round value for room-temperature fullerite. It was not checked against a database entry.

Idealisation: all molecules share one orientation. The real room-temperature phase is orientationally disordered.

Licence: generated structure, no third-party data.

The C=C bonds are 1.40 and 1.45 Å. The intermolecular C-C distance is about 3 Å, outside the bond window, so molecules are not bonded to each other. `complete = "ends"` also shows the far end of a bond that crosses a cell face, so each molecule stays whole at the boundary. `complete = "none"` would cut about 280 bonds across cell faces.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
