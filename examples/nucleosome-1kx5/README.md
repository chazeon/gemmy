# Nucleosome core particle (PDB 1KX5)

The nucleosome core particle: eight histone chains (A to H, cool colours) and two DNA strands (I and J, warm colours). The full particle is in the asymmetric unit (13607 atoms, about 1 s to compile). The DNA atoms are labelled `C_dna`, `N_dna`, `O_dna` and `P_dna` through `labels.json`. Bonds match species labels exactly, so `config.toml` has a covalent rule for each pair of labels (`C` and `C_dna` are different labels).

Source: RCSB PDB 1KX5 (https://files.rcsb.org/download/1KX5.cif). Citation: Davey et al. (2002) J. Mol. Biol. 319, 1097, doi:10.1016/S0022-2836(02)00386-8.

Licence: wwPDB data is released under CC0 (public domain).

Changes:

- Waters, ions and the other HETATM records are dropped.
- The DNA atoms are relabelled in `labels.json`: 2880 C, 1089 N, 1760 O and 292 P, 6021 DNA atoms in total (residues DA, DC, DG and DT). Protein atoms keep their element labels.
- The source has no hydrogen atoms, so none are drawn.
- The atoms were read from the mmCIF with a small stdlib parser and written as extxyz with ASE. The box cell is the bounding box plus 10 Å on each side, with no periodic boundaries.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
