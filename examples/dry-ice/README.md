# Dry ice (solid CO2)

Solid CO2 in the cubic Pa-3 structure at 150 K. The molecules are linear O=C=O units along <111>. The config draws only the C=O bonds (1.0 to 1.3 Å window, about 1.15 Å in the structure), in a 3x3x3 supercell.

Source: Crystallography Open Database entry 9007643, Acta Cryst. B36, 2750 (1980), doi:10.1107/S0567740880009879. Cell a = 5.624 Å, C on the 4a site, O on the 8c site with x = 0.1185.

Licence: COD data is public domain.

Changes: the POSCAR was generated from those parameters with ASE (`ase.spacegroup.crystal`, Pa-3, No. 205), as a 12-atom conventional cell (C4O8). The structure is not a copy of the CIF file.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
