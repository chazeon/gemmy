# UiO-66 (Zr6O4(OH)4(BDC)6 framework)

The UiO-66 metal-organic framework, Fm-3m, one conventional cell. Zr is hidden, and each Zr is shown as a ZrO8 polyhedron (8 O at 2.0 to 2.6 Å). The BDC linkers are drawn as carbon and oxygen with C-C and C-O bonds.

Source: Crystallography Open Database entry 1576630, cell a = 20.7697 Å, Fm-3m (No. 225), T = 298 K. The CIF cites doi:10.1021/acs.inorgchem.6b01004.

Licence: COD data is public domain.

Changes:

- The CIF is an amino-functionalised UiO-66 with the NH2 group at 25 % occupancy on 96 sites. All N is dropped, so the framework is plain UiO-66 with BDC linkers. The framework is complete: 24 Zr, 128 O and 192 C per conventional cell (344 atoms).
- The CIF has no hydrogen atoms. The ring H and the mu3-OH hydrogens were not added, so the structure has no H.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
