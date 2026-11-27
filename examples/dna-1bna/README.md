# B-DNA dodecamer (1BNA)

The Drew-Dickerson B-DNA dodecamer, the full duplex from the asymmetric unit of PDB 1BNA (486 atoms). Drawn free-standing in a box with no periodic images, with thin bonds and small atoms.

Source: RCSB PDB 1BNA (https://files.rcsb.org/download/1BNA.cif). Citation: Drew et al. (1981) Proc. Natl. Acad. Sci. USA 78, 2179, doi:10.1073/pnas.78.4.2179.

Licence: wwPDB data is released under CC0 (public domain).

Changes:

- The asymmetric unit is kept (the whole duplex). Waters are dropped.
- The source has no hydrogen atoms, so none are drawn.
- Box cell: the bounding box plus 8 Å on each side, no periodic boundaries, extxyz.
- Dashed Watson-Crick hydrogen bonds are not drawn. N/O pairs at 2.6 to 3.2 Å give 70 candidates, too noisy to be useful.

The config also draws the flat rings of C and N, the DNA bases: 36 rings (24 six-membered, 12 five-membered) as filled faces.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
