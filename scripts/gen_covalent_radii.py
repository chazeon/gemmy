"""Write web/src/compile/covalent-radii.json from ASE's covalent radii (Cordero et al. 2008).

The viewer's default bonds (web/src/compile/default-rules.ts) read this table. It is generated, not typed by hand, so
the values have one source. Run it from the repository root with `uv run python scripts/gen_covalent_radii.py`.

The file holds "source" (where the values come from) and then one {symbol: radius in angstrom} entry per element, in
atomic-number order. The dummy element X is left out, as is any element ASE has no value for.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from ase.data import chemical_symbols, covalent_radii

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web" / "src" / "compile" / "covalent-radii.json"
DUMMY_SYMBOL = "X"
SOURCE = (
    "ASE ase.data.covalent_radii, from Cordero et al., Dalton Trans. 2008, 2832-2838 (doi:10.1039/B801115J); angstrom"
)


def radii_table() -> dict[str, object]:
    table: dict[str, object] = {"source": SOURCE}
    for symbol, radius in zip(chemical_symbols, covalent_radii, strict=True):
        if symbol == DUMMY_SYMBOL or math.isnan(radius):
            continue
        table[symbol] = float(radius)
    return table


def main() -> None:
    OUTPUT.write_text(json.dumps(radii_table(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
