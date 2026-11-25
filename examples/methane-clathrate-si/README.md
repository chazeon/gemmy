# Methane hydrate (sI clathrate)

The sI clathrate hydrate with methane guests, space group Pm-3n, one conventional cell. The water framework is drawn as dashed O-O lines (2.6 to 3.0 Å), the hydrogen-bond network. Methane is drawn as small grey spheres, carbon only.

Source: Crystallography Open Database entry 4112809, "Gas Hydrate Single-Crystal Structure Analyses", J. Am. Chem. Soc. 126, 9407 (2004), doi:10.1021/ja049247c. Cell a = 11.877 Å, T = 123 K, Pm-3n (No. 223).

Licence: COD data is public domain.

Changes:

- All water hydrogen atoms are dropped. They are half-occupied and disordered, so the hydrogen-bond network is shown as dashed O-O bonds instead.
- The methane hydrogen atoms are dropped too. Their sites are disordered (occupancy 0.33 to 0.5). Only the methane carbon is kept.
- The cell has 46 O and 8 C (54 atoms). The displayed count is higher because of boundary copies.

`config.toml` and `config.json` are the same config in two formats; `render.sh` uses the TOML one.

Run `./render.sh` (needs `gemmy` on PATH or `GEMMY="uv run gemmy"`, and Blender); output goes to `./renders`.
