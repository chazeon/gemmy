"""Crystal structure input: plain `Structure` records and the loader (compile side, uses ASE). POSCAR keeps its
species labels as style keys; other formats ASE reads (extxyz, cif, ...) are picked by file extension."""

from __future__ import annotations

import re
from dataclasses import dataclass
from io import StringIO
from pathlib import Path

from .scene import Vec3


@dataclass(slots=True)
class AtomRecord:
    element: str
    fractional: Vec3
    style_key: str | None = None


@dataclass(slots=True)
class Structure:
    comment: str
    lattice: tuple[Vec3, Vec3, Vec3]
    atoms: list[AtomRecord]


def _is_int_tokens(tokens: list[str]) -> bool:
    if not tokens:
        return False
    try:
        [int(x) for x in tokens]
    except ValueError:
        return False
    return True


def _normalize_species_label(label: str) -> str:
    from ase.data import chemical_symbols  # type: ignore

    if label in chemical_symbols:
        return label
    match = re.match(r"^([A-Z][a-z]?)(?:[\d_+\-].*)?$", label)
    if match is None:
        raise ValueError(f"Cannot normalize POSCAR species label: {label!r}")
    base = match.group(1)
    if base not in chemical_symbols:
        raise ValueError(f"Unsupported POSCAR species label base: {label!r}")
    return base


def _parse_vasp5_species_counts(lines: list[str]) -> tuple[list[str], list[int]] | None:
    if len(lines) < 7:
        return None
    species_tokens = lines[5].split()
    count_tokens = lines[6].split()
    if not species_tokens or not _is_int_tokens(count_tokens):
        return None
    if _is_int_tokens(species_tokens):
        return None
    counts = [int(x) for x in count_tokens]
    if len(species_tokens) != len(counts):
        return None
    return species_tokens, counts


def is_vasp(path: Path) -> bool:
    """POSCAR, CONTCAR or *.vasp: read with the VASP reader that keeps species labels."""
    name = path.name.upper()
    return path.suffix.lower() == ".vasp" or "POSCAR" in name or "CONTCAR" in name


def load_structure(path: str | Path) -> Structure:
    try:
        from ase.io import read  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "ASE is required to load structure input. Install compile deps with: pip install gemmy"
        ) from exc

    if not is_vasp(Path(path)):
        return _from_atoms(read(str(path)), Path(path).name)
    poscar_path = Path(path)
    raw_text = poscar_path.read_text(encoding="utf-8")
    raw_lines = raw_text.splitlines()

    style_keys: list[str] | None = None
    read_source = str(poscar_path)
    parsed = _parse_vasp5_species_counts(raw_lines)
    if parsed is not None:
        raw_species, counts = parsed
        expanded = [species for species, count in zip(raw_species, counts, strict=False) for _ in range(count)]
        style_keys = expanded

        normalized_species = [_normalize_species_label(s) for s in raw_species]
        if normalized_species != raw_species:
            patched_lines = list(raw_lines)
            patched_lines[5] = " ".join(normalized_species)
            read_source = StringIO("\n".join(patched_lines) + "\n")

    return _from_atoms(read(read_source, format="vasp"), poscar_path.name, style_keys)


def _from_atoms(atoms, name: str, style_keys: list[str] | None = None) -> Structure:
    """ASE Atoms -> Structure. The cell must have volume: gemmy works in fractional coordinates."""
    if abs(atoms.cell.volume) < 1e-9:
        raise ValueError(f"{name} has no cell; give it a lattice (non-periodic axes can be a box around the atoms).")
    cell = atoms.get_cell().array
    lattice = (
        (float(cell[0][0]), float(cell[0][1]), float(cell[0][2])),
        (float(cell[1][0]), float(cell[1][1]), float(cell[1][2])),
        (float(cell[2][0]), float(cell[2][1]), float(cell[2][2])),
    )
    entries: list[AtomRecord] = []
    scaled_positions = atoms.get_scaled_positions(wrap=False)
    symbols = atoms.get_chemical_symbols()
    if style_keys is not None and len(style_keys) != len(symbols):
        style_keys = None
    for i, (symbol, position) in enumerate(zip(symbols, scaled_positions, strict=True)):
        frac = (float(position[0]), float(position[1]), float(position[2]))
        style_key = style_keys[i] if style_keys is not None else symbol
        entries.append(AtomRecord(element=symbol, fractional=frac, style_key=style_key))
    return Structure(comment=name, lattice=lattice, atoms=entries)
