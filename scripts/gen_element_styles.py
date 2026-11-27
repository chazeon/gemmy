"""Write the page's element tables: one colour scheme per file, and the sphere radii.

Each colour scheme is web/src/compile/schemes/<id>.json: {"id", "name", "source", "colours": {symbol: "#rrggbb"}}. The
schemes listed in SCHEMES are VESTA and Jmol, read from pymatgen's element colour file,
pymatgen/vis/ElementColorSchemes.yaml (pymatgen, MIT licence). Its "VESTA" table is VESTA's elements.ini (K. Momma and
F. Izumi, J. Appl. Crystallogr. 2011, 44, 1272-1276), and its "Jmol" table is the Jmol palette. A theme made by hand is
one more JSON file in that folder and one line in the registry (web/src/compile/schemes/registry.ts); this script
does not write it.

web/src/compile/element-styles.json holds the radii, which every scheme shares: {"source", "radius_factor", "radii":
{symbol: radius in angstrom}}. The radius is the covalent radius (ase.data.covalent_radii, Cordero et al. 2008, Dalton
Trans. 2832-2838) times RADIUS_FACTOR.

The files are generated, not typed by hand, so they have one source. pymatgen is needed only to find its colour file at
generation time; it is not a dependency of gemmy. Run it from the repository root with
`uv run --with pymatgen python scripts/gen_element_styles.py`, or pass the YAML's path as the first argument.
"""

from __future__ import annotations

import importlib.util
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

from ase.data import chemical_symbols, covalent_radii

ROOT = Path(__file__).resolve().parents[1]
COMPILE = ROOT / "web" / "src" / "compile"
RADII_OUTPUT = COMPILE / "element-styles.json"
SCHEMES_DIR = COMPILE / "schemes"
DUMMY_SYMBOL = "X"
# The sphere radius as a fraction of the covalent radius. Half keeps the spheres of a bonded pair apart: a C-C bond of
# 1.54 A is drawn between two 0.38 A spheres. It gives O 0.33 A, in the range of the committed examples (0.28-0.42 A).
RADIUS_FACTOR = 0.5
# The schemes generated here: the file id, the name the dropdown shows, the section of pymatgen's colour file, a
# one-line description, and the source line the scheme's file carries.
SCHEMES = (
    {
        "id": "vesta",
        "name": "VESTA",
        "section": "VESTA",
        "description": "The reference colours: VESTA's own element colours, the default scheme.",
        "source": (
            "Colours: pymatgen/vis/ElementColorSchemes.yaml (pymatgen, MIT licence), its VESTA table from VESTA's "
            "elements.ini (K. Momma and F. Izumi, J. Appl. Crystallogr. 2011, 44, 1272-1276)."
        ),
    },
    {
        "id": "jmol",
        "name": "Jmol",
        "section": "Jmol",
        "description": "The Jmol palette, the colours of molecular viewers.",
        "source": (
            "Colours: pymatgen/vis/ElementColorSchemes.yaml (pymatgen, MIT licence), its Jmol table (the Jmol palette)."
        ),
    },
)
RADII_SOURCE = (
    "Radii: ase.data.covalent_radii (Cordero et al. 2008, Dalton Trans. 2832-2838) times radius_factor, in angstrom. "
    "Shared by every colour scheme."
)
ENTRY = re.compile(r"^\s+['\"]?([A-Za-z]{1,3})['\"]?:\s*\[\s*(\d+),\s*(\d+),\s*(\d+)\s*\]\s*$")
HEADER = re.compile(r"^([A-Za-z]+):\s*$")

Sections = dict[str, dict[str, tuple[int, int, int]]]


def colour_file() -> Path:
    """pymatgen's colour file, found without running pymatgen (the package is imported only for its location)."""
    try:
        spec = importlib.util.find_spec("pymatgen.vis")
    except ModuleNotFoundError:
        spec = None
    if spec is None or spec.origin is None:
        sys.exit("pymatgen is not installed: run `uv run --with pymatgen python scripts/gen_element_styles.py`")
    return Path(spec.origin).parent / "ElementColorSchemes.yaml"


def read_sections(path: Path) -> Sections:
    """The file's tables: {section: {symbol: (r, g, b)}}. The file is flat (one section header, then one entry per
    line), so it is read line by line rather than with a YAML parser the generator would have to add."""
    sections: Sections = {}
    current: dict[str, tuple[int, int, int]] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        header = HEADER.match(line)
        if header:
            current = sections.setdefault(header.group(1), {})
            continue
        entry = ENTRY.match(line)
        if entry is None or current is None:
            raise ValueError(f"{path}: unexpected line {line!r}")
        current[entry.group(1)] = (int(entry.group(2)), int(entry.group(3)), int(entry.group(4)))
    return sections


def covered_symbols(sections: Sections) -> list[str]:
    """The elements with a covalent radius and a colour in every scheme, in atomic-number order."""
    symbols = []
    for symbol, covalent in zip(chemical_symbols, covalent_radii, strict=False):
        if symbol == DUMMY_SYMBOL or math.isnan(covalent):
            continue
        if all(symbol in sections[scheme["section"]] for scheme in SCHEMES):
            symbols.append(symbol)
    return symbols


def hex_colour(rgb: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{channel:02x}" for channel in rgb)


def radii_file(symbols: list[str]) -> dict[str, Any]:
    radii = {
        symbol: round(float(covalent_radii[chemical_symbols.index(symbol)]) * RADIUS_FACTOR, 3) for symbol in symbols
    }
    return {"source": RADII_SOURCE, "radius_factor": RADIUS_FACTOR, "radii": radii}


def scheme_file(scheme: dict[str, str], sections: Sections, symbols: list[str]) -> dict[str, Any]:
    table = sections[scheme["section"]]
    colours = {symbol: hex_colour(table[symbol]) for symbol in symbols}
    return {
        "id": scheme["id"],
        "name": scheme["name"],
        "description": scheme["description"],
        "source": scheme["source"],
        "colours": colours,
    }


def outputs(sections: Sections) -> dict[Path, str]:
    """Each file's path and text: the radii, then one file per scheme. The text is what json.dumps writes, which biome
    keeps as it is (one entry per line)."""
    symbols = covered_symbols(sections)
    files = {RADII_OUTPUT: radii_file(symbols)}
    for scheme in SCHEMES:
        files[SCHEMES_DIR / f"{scheme['id']}.json"] = scheme_file(scheme, sections, symbols)
    return {path: json.dumps(content, indent=2, ensure_ascii=False) + "\n" for path, content in files.items()}


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else colour_file()
    SCHEMES_DIR.mkdir(exist_ok=True)
    for path, text in outputs(read_sections(source)).items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} from {source}")


if __name__ == "__main__":
    main()
