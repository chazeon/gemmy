"""Parity of the TypeScript compile side with the Python one, stage by stage: the structure reader (web/src/structure)
against gemmy.readers.load_structure, the LAMMPS and content-detected readers on their own fixtures, and the supercell
neighbour source against Python's ordered neighbour graph (gemmy.compile.bonds.build_neighbor_graph). Each group runs
its jobs in one node process (tests/ts_bundle.py).

The whole-scene comparison is test_ts_compile.py (a later stage); these narrow down a failure before it.
"""

from __future__ import annotations

import functools
import importlib.util
import itertools
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
STRUCTURES = FIXTURES / "structures"
EXAMPLES = ROOT / "examples"
TOLERANCE = 1e-9
# Atom positions and cells are plain copies of the same numbers, so they must agree to rounding.
POSITION_TOLERANCE = 1e-12
# Examples above 5000 atoms: their reads take seconds, so they run under -m slow.
LARGE_EXAMPLES = frozenset({"apoferritin", "nav17-6j8i", "nucleosome-1kx5"})

DEPS_AVAILABLE = all(importlib.util.find_spec(m) is not None for m in ("ase", "numpy"))
pytestmark = [
    pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)"),
    pytest.mark.skipif(not DEPS_AVAILABLE, reason="ASE and NumPy are required for the parity tests"),
]


def _example_structure(name: str) -> Path:
    config = json.loads((EXAMPLES / name / "config.json").read_text(encoding="utf-8"))
    return EXAMPLES / name / config["structure"]


# Plain path lists only: nothing here imports ASE or NumPy, so a missing optional dependency skips the tests instead
# of failing the collection. The structures are built inside the tests.
FIXTURE_POSCARS = [FIXTURES / name / "POSCAR" for name in ("box", "corner_poly", "hydroxide", "labels", "rocksalt")]
FIXTURE_POSCARS += [FIXTURES / name / "POSCAR" for name in ("select_shell", "wrap")] + [FIXTURES / "wrap/POSCAR.alt"]
STRUCTURE_FILES = [
    STRUCTURES / "vasp4" / "POSCAR",
    STRUCTURES / "vasp5-pv" / "POSCAR",
    STRUCTURES / "cif" / "NaCl-fm3m.cif",
    STRUCTURES / "extxyz-x" / "x-species.extxyz",
]
# A VASP 5 species label that names no element and so is the X dummy, in both readers.
DUMMY_LABEL = STRUCTURES / "dummy-label" / "POSCAR"
SMALL_EXAMPLES = [
    _example_structure(p.parent.name)
    for p in sorted(EXAMPLES.glob("*/config.json"))
    if p.parent.name not in LARGE_EXAMPLES
]
LARGE = [_example_structure(name) for name in sorted(LARGE_EXAMPLES)]
SMALL = [str(path) for path in FIXTURE_POSCARS + STRUCTURE_FILES + SMALL_EXAMPLES]
DUMP = STRUCTURES / "two-types" / "two-types.dump"
MGO_MASSES = STRUCTURES / "lammps-masses" / "mgo-masses.data"
TRICLINIC_LABELS = STRUCTURES / "lammps-triclinic" / "triclinic-labels.data"
X_LABEL = STRUCTURES / "lammps-x-label" / "x-label.data"
TILTED = STRUCTURES / "lammps-tilted" / "tilted-origin.data"
LABELS_DATA = STRUCTURES / "lammps-labels" / "labels.data"
ELEMENT_COLUMN_DUMP = STRUCTURES / "lammps-element-column" / "element-column.dump"
VASP5_PV = STRUCTURES / "vasp5-pv" / "POSCAR"


def _id(path: Path) -> str:
    return str(path.relative_to(ROOT))


def _read_call(
    text: str,
    file_name: str,
    types: dict[str, str] | None = None,
    format: str | None = None,
    config: bool = False,
) -> dict[str, Any]:
    """A job that calls the bundle's readStructure on a file's text. `types` is the page's map (lenient), or the
    config's map (strict) with `config`."""
    options: dict[str, Any] = {"fileName": file_name}
    if types is not None:
        options["configTypes" if config else "pageTypes"] = types
    if format is not None:
        options["format"] = format
    return {"fn": "readStructure", "args": [text, options]}


def _read_job(path: str) -> dict[str, Any]:
    source = Path(path)
    return _read_call(source.read_text(encoding="utf-8"), source.name)


@functools.cache
def _readings(paths: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """The reader's structure for each path, from one node process."""
    results = run([_read_job(path) for path in paths])
    out: dict[str, dict[str, Any]] = {}
    for path, result in zip(paths, results, strict=True):
        assert "ok" in result, f"{path}: {result.get('error')}"
        out[path] = result["ok"]["structure"]
    return out


def _close(a: list[float], b: list[float], tolerance: float = TOLERANCE) -> bool:
    return len(a) == len(b) and all(abs(x - y) <= tolerance for x, y in zip(a, b, strict=True))


def _assert_same_structure(ts: dict[str, Any], py: Any) -> None:
    assert ts["comment"] == py.comment
    assert [a.element for a in py.atoms] == [a["element"] for a in ts["atoms"]]
    assert all(a.style_key is not None for a in py.atoms)  # the Python side never has None here
    assert [a.style_key for a in py.atoms] == [a["styleKey"] for a in ts["atoms"]]
    assert all(_close(row, expected) for row, expected in zip(ts["lattice"], py.lattice, strict=True))
    assert all(_close(a["fractional"], r.fractional) for a, r in zip(ts["atoms"], py.atoms, strict=True))


@pytest.mark.parametrize("path", FIXTURE_POSCARS + STRUCTURE_FILES + SMALL_EXAMPLES, ids=_id)
def test_reader_matches_load_structure(path: Path) -> None:
    from gemmy.readers import load_structure

    _assert_same_structure(_readings(tuple(SMALL))[str(path)], load_structure(path))


@pytest.mark.slow
@pytest.mark.parametrize("path", LARGE, ids=_id)
def test_reader_matches_load_structure_on_large_examples(path: Path) -> None:
    from gemmy.readers import load_structure

    _assert_same_structure(_readings((str(path),))[str(path)], load_structure(path))


def test_cell_with_zero_volume_raises_the_same_error_as_python() -> None:
    from gemmy.readers import load_structure

    path = STRUCTURES / "zero-cell" / "POSCAR"
    with pytest.raises(ValueError) as python_error:
        load_structure(path)
    result = run([_read_job(str(path))])[0]
    assert "error" in result, result
    assert result["error"] == str(python_error.value)


def test_unknown_element_label_stays_a_dummy_atom() -> None:
    # The C60-cage example needs a dummy centre: a label fastatoms cannot resolve is the element X, keyed by its label.
    atoms = _readings((str(DUMMY_LABEL),))[str(DUMMY_LABEL)]["atoms"]
    assert [a["element"] for a in atoms] == ["Fe", "Fe", "X"]
    assert [a["styleKey"] for a in atoms] == ["Fe1", "Fe2", "Xc"]


def test_unknown_element_label_matches_load_structure() -> None:
    from gemmy.readers import load_structure

    _assert_same_structure(_readings((str(DUMMY_LABEL),))[str(DUMMY_LABEL)], load_structure(DUMMY_LABEL))


# ---------------------------------------------------------------------------
# Format detection: one row per read, whatever the file is called
# ---------------------------------------------------------------------------


def _without_comment(result: dict[str, Any]) -> dict[str, Any]:
    """A read result with the file name removed: the comment is the name by design, so the rest must be equal."""
    structure = dict(result["ok"]["structure"], comment="")
    return {"structure": structure, "unresolvedTypes": result["ok"]["unresolvedTypes"]}


@pytest.mark.parametrize(
    ("path", "types", "format"),
    [
        (DUMP, None, "lammps-dump"),
        (DUMP, {"1": "Mg", "2": "O"}, "lammps-dump"),
        (VASP5_PV, None, "vasp"),
    ],
    ids=["dump", "dump-with-types", "vasp5-pv"],
)
def test_renamed_or_explicit_format_reads_like_the_proper_name(path: Path, types: dict | None, format: str) -> None:
    text = path.read_text(encoding="utf-8")
    proper = _read_call(text, path.name, types)
    renamed = _read_call(text, "trajectory", types)
    explicit = _read_call(text, "trajectory", types, format=format)
    results = run([proper, renamed, explicit])
    assert all("ok" in result for result in results), results
    first = _without_comment(results[0])
    assert _without_comment(results[1]) == first
    assert _without_comment(results[2]) == first


def test_content_detected_vasp5_keeps_its_species_labels() -> None:
    # fastatoms cannot tell this VASP 5 file from its text under the name "trajectory", so the reader tries each row:
    # the labels (Fe_pv) must survive, as they do under the name POSCAR.
    text = VASP5_PV.read_text(encoding="utf-8")
    result = run([_read_call(text, "trajectory")])[0]
    assert [a["styleKey"] for a in result["ok"]["structure"]["atoms"]] == ["Fe_pv", "O"]


def test_plain_xyz_name_reads_the_extended_header() -> None:
    # The extxyz row passes "extxyz" to fastatoms, so a .xyz file with an extended header keeps its lattice and labels.
    text = (STRUCTURES / "extxyz-x" / "x-species.extxyz").read_text(encoding="utf-8")
    result = run([_read_call(text, "x-species.xyz")])[0]
    assert "ok" in result, result
    structure = result["ok"]["structure"]
    assert structure["lattice"] == [[4, 0, 0], [0, 4, 0], [0, 0, 4]]
    assert [a["element"] for a in structure["atoms"]] == ["Fe", "X", "O"]


def test_content_wins_over_the_name_for_a_lammps_dump_called_xyz() -> None:
    # fastatoms reads the dump magic in the text, so a dump named traj.xyz is read as a dump, with the same labels and
    # the same unresolved-type report as under its proper name.
    text = DUMP.read_text(encoding="utf-8")
    results = run(
        [
            _read_call(text, "two-types.dump"),
            _read_call(text, "traj.xyz"),
            _read_call(text, "traj.xyz", {"1": "Mg", "2": "O"}),
        ]
    )
    assert all("ok" in result for result in results), results
    proper, unmapped, mapped = results
    assert unmapped["ok"]["unresolvedTypes"] == [1, 2]
    assert [a["styleKey"] for a in unmapped["ok"]["structure"]["atoms"]] == ["1", "2", "1"]
    assert _without_comment(unmapped) == _without_comment(proper)
    assert [a["element"] for a in mapped["ok"]["structure"]["atoms"]] == ["Mg", "O", "Mg"]
    assert mapped["ok"]["unresolvedTypes"] == []


def test_unnamed_plain_xyz_is_recognised_as_xyz() -> None:
    # A plain XYZ (no extended header) has no cell, which gemmy refuses after the read. The error is that one, not
    # "cannot tell its format", so the format was recognised from the text alone.
    plain = "2\ncomment\nFe 0 0 0\nO 1 1 1\n"
    result = run([_read_call(plain, "unnamed")])[0]
    assert "error" in result, result
    assert "has no cell" in result["error"], result["error"]
    assert "cannot tell" not in result["error"]


def test_unnamed_extended_xyz_is_read_from_its_header() -> None:
    text = (STRUCTURES / "extxyz-x" / "x-species.extxyz").read_text(encoding="utf-8")
    result = run([_read_call(text, "unnamed")])[0]
    assert "ok" in result, result
    assert result["ok"]["structure"]["lattice"] == [[4, 0, 0], [0, 4, 0], [0, 0, 4]]
    assert [a["element"] for a in result["ok"]["structure"]["atoms"]] == ["Fe", "X", "O"]


# ---------------------------------------------------------------------------
# Failed reads leave the wasm module usable
# ---------------------------------------------------------------------------

ROCKSALT = FIXTURES / "rocksalt" / "POSCAR"
ROCKSALT_CUTOFF = 4.5
ROCKSALT_SUPERCELL = [2, 1, 1]


def _malformed_texts() -> list[str]:
    """Inputs that every reader refuses: garbage, a truncated POSCAR and a dump whose atom count is not a number."""
    poscar = ROCKSALT.read_text(encoding="utf-8").splitlines()
    dump = DUMP.read_text(encoding="utf-8")
    return [
        "this is not a structure\n\x00\x01 at all\n",
        "\n".join(poscar[:6]) + "\n",
        "\n".join(poscar[:4]) + "\nDirect\n0.0 0.0 0.0\n",
        dump.replace("ITEM: NUMBER OF ATOMS\n3", "ITEM: NUMBER OF ATOMS\nmany"),
    ]


def test_failed_reads_leave_the_reader_usable() -> None:
    # 500 failing reads of malformed inputs in one process, between a valid read and a neighbour source on it: the
    # valid read and the neighbour pairs after the failures must equal those before them.
    valid = ROCKSALT.read_text(encoding="utf-8")
    before_read = _read_call(valid, "POSCAR")
    structure = run([before_read])[0]["ok"]["structure"]
    neighbors = {"fn": "neighborSnapshot", "args": [structure, ROCKSALT_SUPERCELL, [True, True, True], ROCKSALT_CUTOFF]}
    names = ["POSCAR", "traj.xyz", "x.dump", "unnamed"]
    malformed = _malformed_texts()
    failures = [_read_call(malformed[k % len(malformed)], names[k % len(names)]) for k in range(500)]
    jobs = [before_read, neighbors, *failures, _read_call(valid, "POSCAR"), neighbors]
    results = run(jobs)
    assert all("error" in result for result in results[2:502]), [r for r in results[2:502] if "error" not in r][:3]
    assert results[502] == results[0]
    assert results[503] == results[1]
    assert "ok" in results[503], results[503]


# ---------------------------------------------------------------------------
# LAMMPS readers and type labels
# ---------------------------------------------------------------------------


@functools.cache
def _lammps() -> dict[str, dict[str, Any]]:
    """The LAMMPS fixtures read in one node process, by name. Errors are kept (they are the outcome under test)."""
    dump = DUMP.read_text(encoding="utf-8")
    mgo = MGO_MASSES.read_text(encoding="utf-8")
    triclinic = TRICLINIC_LABELS.read_text(encoding="utf-8")
    jobs = {
        "mgo": _read_call(mgo, "m.data"),
        "triclinic": _read_call(triclinic, "t.data"),
        "triclinic_map": _read_call(triclinic, "t.data", types={"1": "Mg", "2": "O"}),
        "x_label": _read_call((X_LABEL).read_text(encoding="utf-8"), "x.data"),
        "tilted": _read_call(TILTED.read_text(encoding="utf-8"), "tilted-origin.data"),
        "unmapped": _read_call(dump, "two-types.dump"),
        "mapped": _read_call(dump, "two-types.dump", types={"1": "Mg", "2": "O"}),
        "partial": _read_call(dump, "two-types.dump", types={"1": "Mg"}),
        "label_number": _read_call(dump, "two-types.dump", types={"1": "1", "2": "O"}),
        "label_qq": _read_call(dump, "two-types.dump", types={"1": "Qq", "2": "O"}),
        "masses_conflict": _read_call(mgo.replace("1 24.305 # Mg", "1 99.0 # Mg"), "m.data"),
    }
    results = run(list(jobs.values()))
    return dict(zip(jobs, results, strict=True))


def _ok(name: str) -> dict[str, Any]:
    result = _lammps()[name]
    assert "ok" in result, f"{name}: {result.get('error')}"
    return result["ok"]


def test_lammps_data_with_masses_comments_names_the_elements() -> None:
    mgo = _ok("mgo")
    assert mgo["unresolvedTypes"] == []
    atoms = mgo["structure"]["atoms"]
    assert [a["element"] for a in atoms] == ["Mg", "O", "O", "Mg", "O", "Mg", "Mg", "O"]
    assert [a["styleKey"] for a in atoms] == [a["element"] for a in atoms]
    assert mgo["structure"]["lattice"] == [[4.2, 0, 0], [0, 4.2, 0], [0, 0, 4.2]]


def test_lammps_triclinic_box_and_type_labels() -> None:
    triclinic = _ok("triclinic")
    lx, ly, lz, xy, xz, yz = 3.0, 4.0, 5.0, 1.0, 0.5, 0.25
    expected = [[lx, 0, 0], [xy, ly, 0], [xz, yz, lz]]  # a = (lx,0,0), b = (xy,ly,0), c = (xz,yz,lz)
    cell = triclinic["structure"]["lattice"]
    assert all(_close(row, want) for row, want in zip(cell, expected, strict=True))
    atoms = triclinic["structure"]["atoms"]
    assert [a["styleKey"] for a in atoms] == ["Fe1", "O", "O", "Fe1"]
    assert [a["element"] for a in atoms] == ["Fe", "O", "O", "Fe"]
    assert triclinic["unresolvedTypes"] == []


def test_lammps_types_map_overrides_the_atom_type_labels() -> None:
    # The file's Atom Type Labels say type 1 is Fe1; the map given to the read wins.
    atoms = _ok("triclinic_map")["structure"]["atoms"]
    assert [a["element"] for a in atoms] == ["Mg", "O", "O", "Mg"]
    assert [a["styleKey"] for a in atoms] == ["Mg", "O", "O", "Mg"]


def test_lammps_tilted_origin_gives_the_hand_computed_fractions() -> None:
    # The box origin is (1,-2,0.5), so the fractions are relative to it. Hand-computed in the fixture's header:
    # (0.5,0.25,0.4), (0,0,0) and (0.9,0.5,0.5) in the cell a=(3,0,0), b=(1,4,0), c=(0.5,0.25,5).
    tilted = _ok("tilted")
    structure = tilted["structure"]
    assert structure["lattice"] == [[3, 0, 0], [1, 4, 0], [0.5, 0.25, 5]]
    assert [a["element"] for a in structure["atoms"]] == ["Fe", "O", "Fe"]
    fractions = [a["fractional"] for a in structure["atoms"]]
    expected = [[0.5, 0.25, 0.4], [0, 0, 0], [0.9, 0.5, 0.5]]
    assert all(_close(got, want) for got, want in zip(fractions, expected, strict=True)), fractions
    assert tilted["unresolvedTypes"] == []


def test_lammps_type_labelled_x_is_resolved() -> None:
    # The label "X" resolves type 1 to the element X: it is not an unresolved type (its label is not "1").
    x_label = _ok("x_label")
    assert x_label["unresolvedTypes"] == []
    assert [a["element"] for a in x_label["structure"]["atoms"]] == ["X", "O", "O", "X"]


def test_lammps_dump_without_a_map_reports_the_unresolved_types() -> None:
    unmapped = _ok("unmapped")
    assert unmapped["unresolvedTypes"] == [1, 2]
    assert [a["element"] for a in unmapped["structure"]["atoms"]] == ["X", "X", "X"]
    assert [a["styleKey"] for a in unmapped["structure"]["atoms"]] == ["1", "2", "1"]


def test_lammps_dump_with_a_map_resolves_every_type() -> None:
    mapped = _ok("mapped")
    assert mapped["unresolvedTypes"] == []
    assert [a["element"] for a in mapped["structure"]["atoms"]] == ["Mg", "O", "Mg"]


def test_lammps_partial_map_leaves_the_other_types_unresolved() -> None:
    # The map names type 1 only: type 2 falls back to X and is the one unresolved type.
    partial = _ok("partial")
    assert partial["unresolvedTypes"] == [2]
    assert [a["element"] for a in partial["structure"]["atoms"]] == ["Mg", "X", "Mg"]
    assert [a["styleKey"] for a in partial["structure"]["atoms"]] == ["Mg", "2", "Mg"]


def test_lammps_map_label_that_names_no_element_is_an_error() -> None:
    error = _lammps()["label_qq"]
    assert "error" in error, error
    assert "cannot tell which element the label 'Qq' names" in error["error"]


def test_lammps_map_label_equal_to_the_type_number_is_an_error() -> None:
    # fastatoms reads "1" as a label that names no element, so a map that repeats the bare type number fails.
    error = _lammps()["label_number"]
    assert "error" in error, error
    assert "cannot tell which element the label '1' names" in error["error"]


def test_lammps_masses_comment_that_contradicts_its_mass_is_an_error() -> None:
    error = _lammps()["masses_conflict"]
    assert "error" in error, error
    assert "Masses comment names element 'Mg'" in error["error"]


def test_extxyz_with_an_x_species_has_no_unresolved_types() -> None:
    # Only a LAMMPS file has types: an atom whose element is X is not an unresolved type.
    path = STRUCTURES / "extxyz-x" / "x-species.extxyz"
    result = run([_read_job(str(path))])[0]
    assert result["ok"]["unresolvedTypes"] == []
    assert [a["element"] for a in result["ok"]["structure"]["atoms"]] == ["Fe", "X", "O"]


# ---------------------------------------------------------------------------
# LAMMPS type maps: Python's load_structure(path, types) against readStructure(text, {configTypes})
# ---------------------------------------------------------------------------

# Each file with a map that names every one of its types (a partial map is not compared: Python refuses it, while the
# reader resolves a type the file's own masses or labels give).
TYPE_MAP_CASES = [
    (DUMP, {1: "Mg", 2: "O"}),
    (DUMP, {1: "Fe1", 2: "O_oct"}),
    (MGO_MASSES, {1: "Fe1", 2: "O"}),
    (TRICLINIC_LABELS, {1: "Mg", 2: "O"}),
    (X_LABEL, {1: "Xc", 2: "O"}),
    (TILTED, {1: "Fe", 2: "O"}),
    (LABELS_DATA, {1: "d1", 2: "CA1"}),
    (ELEMENT_COLUMN_DUMP, {1: "O", 2: "Mg"}),
    (STRUCTURES / "lammps-origin" / "origin.dump", {1: "Fe", 2: "O"}),
    (STRUCTURES / "lammps-origin" / "origin-scaled.dump", {1: "Fe", 2: "O"}),
]


@pytest.mark.parametrize(("path", "types"), TYPE_MAP_CASES, ids=[p.name for p, _ in TYPE_MAP_CASES])
def test_lammps_type_map_reads_like_python(path: Path, types: dict[int, str]) -> None:
    from gemmy.readers import load_structure

    python = load_structure(path, types)
    call = _read_call(path.read_text(encoding="utf-8"), path.name, {str(k): v for k, v in types.items()}, config=True)
    (result,) = run([call])
    assert "ok" in result, result.get("error")
    ts = result["ok"]
    assert ts["unresolvedTypes"] == []
    ts_atoms = ts["structure"]["atoms"]
    assert [a.element for a in python.atoms] == [a["element"] for a in ts_atoms]
    assert [a.style_key for a in python.atoms] == [a["styleKey"] for a in ts_atoms]
    assert all(_close(list(row), want) for row, want in zip(ts["structure"]["lattice"], python.lattice, strict=True))
    for atom, ts_atom in zip(python.atoms, ts_atoms, strict=True):
        assert _close(list(atom.fractional), ts_atom["fractional"]), (atom.fractional, ts_atom["fractional"])


def test_a_map_label_sets_the_element_by_the_element_rule() -> None:
    """The element of a label is gemmy's rule on both sides: `d1` is hydrogen and `CA1` is calcium, and a dump's element
    column does not override a map."""
    from gemmy.readers import load_structure

    python = load_structure(LABELS_DATA, {1: "d1", 2: "CA1"})
    assert [a.element for a in python.atoms] == ["H", "Ca"]
    dump = load_structure(ELEMENT_COLUMN_DUMP, {1: "O", 2: "Mg"})
    assert [a.element for a in dump.atoms] == ["O", "Mg"]
    for path, types, want in [
        (LABELS_DATA, {1: "d1", 2: "CA1"}, ["H", "Ca"]),
        (ELEMENT_COLUMN_DUMP, {1: "O", 2: "Mg"}, ["O", "Mg"]),
    ]:
        call = _read_call(
            path.read_text(encoding="utf-8"), path.name, {str(k): v for k, v in types.items()}, config=True
        )
        (result,) = run([call])
        assert [a["element"] for a in result["ok"]["structure"]["atoms"]] == want


@pytest.mark.parametrize(("path", "types"), TYPE_MAP_CASES, ids=[p.name for p, _ in TYPE_MAP_CASES])
def test_partial_config_map_is_refused_by_python_and_by_ts_with_the_same_message(
    path: Path, types: dict[int, str]
) -> None:
    """A config's map that leaves a type of the file unnamed is an error in both, with the same text (the page shows it
    on the card). The page's own map is lenient and does not refuse it
    (test_lammps_partial_map_leaves_the_other_types_unresolved)."""
    from gemmy.readers import load_structure

    partial = dict(list(types.items())[:1])
    missing = sorted(set(types) - set(partial))  # each case's full map names every type of its file
    assert missing, "the fixture's types are all named by the partial map"
    with pytest.raises(
        ValueError, match=rf"types {re.escape(str(missing))} have no label.*`types` key"
    ) as python_error:
        load_structure(path, partial)
    call = _read_call(path.read_text(encoding="utf-8"), path.name, {str(k): v for k, v in partial.items()}, config=True)
    (result,) = run([call])
    assert result == {"error": str(python_error.value), "type": result["type"]}, result


def test_config_map_on_a_file_that_is_not_lammps_is_refused_as_python_refuses_it() -> None:
    from gemmy.readers import load_structure

    poscar = FIXTURES / "box" / "POSCAR"
    with pytest.raises(ValueError) as python_error:
        load_structure(poscar, {1: "Fe"})
    call = _read_call(poscar.read_text(encoding="utf-8"), poscar.name, {"1": "Fe"}, config=True)
    (result,) = run([call])
    assert result == {"error": str(python_error.value), "type": result["type"]}, result


def test_a_page_map_restricted_to_the_unresolved_types_reports_nothing_more(tmp_path: Path) -> None:
    """Type 1 is named by the file's own Atom Type Labels, type 2 is not. The page's form asks for type 2 only, and the
    map it gives (type 2 alone) reads with nothing left unresolved: a lenient map does not report the type the file
    resolves. The config's strict rule would refuse the same map, as Python does."""
    data = tmp_path / "two-labels.data"
    data.write_text(TWO_TYPE_LABELS_DATA, encoding="utf-8")
    text = data.read_text(encoding="utf-8")
    unmapped, restricted, strict = run(
        [
            _read_call(text, data.name),
            _read_call(text, data.name, {"2": "O"}),
            _read_call(text, data.name, {"2": "O"}, config=True),
        ]
    )
    assert unmapped["ok"]["unresolvedTypes"] == [2]
    assert restricted["ok"]["unresolvedTypes"] == []
    assert [a["element"] for a in restricted["ok"]["structure"]["atoms"]] == ["Fe", "O"]
    assert strict == {
        "error": f"{data.name}: LAMMPS types [1] have no label. Name each in the config's `types` key, "
        f'e.g. `1 = "Fe1"`.',
        "type": strict["type"],
    }, strict


TWO_TYPE_LABELS_DATA = """LAMMPS data, type 1 labelled Fe1 and type 2 not (synthetic)

2 atoms
2 atom types

0.0 4.0 xlo xhi
0.0 4.0 ylo yhi
0.0 4.0 zlo zhi

Atom Type Labels

1 Fe1

Atoms # atomic

1 1 0.5 0.5 0.5
2 2 2.5 2.5 2.5
"""


# ---------------------------------------------------------------------------
# A dropped config's map on the card (ui/type-resolution.ts resolveTypes): its error is the card's message, the same
# text Python raises
# ---------------------------------------------------------------------------


def _card_message(path: Path, types: dict[str, str]) -> str | None:
    """The message the card shows for a structure with a dropped config's map (None when they resolve)."""
    (result,) = run([{"fn": "resolveConfigTypes", "args": [path.name, path.read_text(encoding="utf-8"), types]}])
    return result["ok"] if "ok" in result else result["error"]


def test_a_config_map_on_a_file_that_is_not_lammps_shows_the_python_error_on_the_card() -> None:
    from gemmy.readers import load_structure

    poscar = FIXTURES / "box" / "POSCAR"
    with pytest.raises(ValueError) as python_error:
        load_structure(poscar, {1: "Fe"})
    assert _card_message(poscar, {"1": "Fe"}) == str(python_error.value)


def test_a_config_map_that_leaves_a_type_unnamed_shows_the_python_error_on_the_card() -> None:
    from gemmy.readers import load_structure

    with pytest.raises(ValueError) as python_error:
        load_structure(MGO_MASSES, {1: "Mg"})
    assert _card_message(MGO_MASSES, {"1": "Mg"}) == str(python_error.value)


def test_a_config_map_that_names_every_type_leaves_the_card_no_message() -> None:
    assert _card_message(MGO_MASSES, {"1": "Mg", "2": "O"}) is None


# ---------------------------------------------------------------------------
# Neighbour source against Python's ordered neighbour graph
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NeighborCase:
    name: str
    # None: the rocksalt fixture. A number: a random triclinic structure with five atoms, drawn from this seed.
    seed: int | None
    supercell: tuple[int, int, int]
    periodic: tuple[bool, bool, bool]
    cutoff: float
    # Fractional coordinates of the random structure are drawn from [low, high).
    low: float = 0.0
    high: float = 1.0


NEIGHBOR_CASES = [
    NeighborCase("rocksalt", None, (2, 1, 1), (True, True, True), 4.5),
    NeighborCase("triclinic-mixed-pbc", 7, (2, 1, 1), (True, False, True), 5.0),
    NeighborCase("triclinic-all-pbc", 11, (2, 1, 1), (True, True, True), 5.5),
    # A multi-axis supercell whose fractional coordinates lie outside [0, 1).
    NeighborCase("multi-axis-outside-cell", 13, (2, 3, 2), (True, True, True), 4.5, low=-1.5, high=2.5),
]


def _random_structure(seed: int, low: float, high: float) -> Any:
    """A random triclinic cell with five atoms (a seeded NumPy generator)."""
    import numpy as np

    from gemmy.readers.record import AtomRecord, Structure

    rng = np.random.default_rng(seed)
    lattice = np.eye(3) * 4.0 + rng.uniform(-1.2, 1.2, (3, 3))
    atoms = []
    for k in range(5):
        element = ("O", "Si", "Na")[k % 3]
        fractional = tuple(float(x) for x in rng.uniform(low, high, 3))
        atoms.append(AtomRecord(element=element, fractional=fractional, style_key=element))
    cell = tuple(tuple(float(x) for x in row) for row in lattice)
    return Structure(comment=f"random-{seed}", lattice=cell, atoms=atoms)


def _structure_of(case: NeighborCase) -> Any:
    """The case's structure, built now: the Python loader and NumPy are imported here, not at collection."""
    if case.seed is None:
        from gemmy.readers import load_structure

        return load_structure(FIXTURES / "rocksalt" / "POSCAR")
    return _random_structure(case.seed, case.low, case.high)


def _structure_json(structure: Any) -> dict[str, Any]:
    return {
        "comment": structure.comment,
        "lattice": [list(row) for row in structure.lattice],
        "atoms": [
            {"element": a.element, "fractional": list(a.fractional), "styleKey": a.style_key or a.element}
            for a in structure.atoms
        ],
    }


def _neighbor_job(structure: Any, case: NeighborCase, cutoff: float) -> dict[str, Any]:
    return {
        "fn": "neighborSnapshot",
        "args": [_structure_json(structure), list(case.supercell), list(case.periodic), cutoff],
    }


@functools.cache
def _neighbor_results() -> list[dict[str, Any]]:
    """The TypeScript snapshot of every case, from one node process."""
    jobs = [_neighbor_job(_structure_of(case), case, case.cutoff) for case in NEIGHBOR_CASES]
    results = run(jobs)
    assert all("ok" in result for result in results), results
    return [result["ok"] for result in results]


def _flat(rows: list[list[float]]) -> list[float]:
    return list(itertools.chain.from_iterable(rows))


def _python_supercell(case: NeighborCase) -> Any:
    """The case's supercell as ASE holds it (the reference the TypeScript source is compared with)."""
    import numpy as np
    from ase import Atoms

    structure = _structure_of(case)
    base = Atoms(
        symbols=[a.element for a in structure.atoms],
        scaled_positions=[a.fractional for a in structure.atoms],
        cell=np.asarray(structure.lattice, dtype=float),
        pbc=case.periodic,
    )
    atoms = base.repeat(case.supercell)
    atoms.set_pbc(case.periodic)
    return atoms


def _python_reference(case: NeighborCase) -> dict[str, Any]:
    """The supercell and its neighbour graph as the compile stages see them: the pairs in the order
    build_neighbor_graph gives (atoms by index, each atom's neighbours by (index, shift))."""
    from gemmy.compile.bonds import build_neighbor_graph

    atoms = _python_supercell(case)
    graph = build_neighbor_graph(atoms, case.cutoff)
    pairs = [(i, nb.index, nb.shift, nb.distance) for i in sorted(graph) for nb in graph[i]]
    return {
        "pairs": pairs,
        "cell": atoms.cell.array.tolist(),
        "positions": atoms.positions.tolist(),
        "scaled": atoms.get_scaled_positions(wrap=False).tolist(),
        "symbols": atoms.get_chemical_symbols(),
    }


def _ts_pairs(result: dict[str, Any]) -> list[tuple[int, int, tuple[int, int, int], float]]:
    """The TypeScript pairs in the order the reader returns them, in the same shape as _python_reference's."""
    i, j, S, d = result["i"], result["j"], result["S"], result["d"]
    return [(i[n], j[n], (S[3 * n], S[3 * n + 1], S[3 * n + 2]), d[n]) for n in range(len(i))]


@pytest.mark.parametrize("index", range(len(NEIGHBOR_CASES)), ids=[c.name for c in NEIGHBOR_CASES])
def test_neighbor_source_matches_the_python_graph_order(index: int) -> None:
    case = NEIGHBOR_CASES[index]
    result = _neighbor_results()[index]
    expected = _python_reference(case)
    assert result["symbols"] == expected["symbols"]
    for key in ("cell", "positions", "scaled"):
        assert _close(_flat(result[key]), _flat(expected[key]), POSITION_TOLERANCE), key
    ts_pairs = _ts_pairs(result)
    # The order itself is compared: both sides sort by (i, j, S), so the lists must be equal, not just the same set.
    assert [pair[:3] for pair in ts_pairs] == [pair[:3] for pair in expected["pairs"]]
    assert _close([pair[3] for pair in ts_pairs], [pair[3] for pair in expected["pairs"]], TOLERANCE)
    assert len(ts_pairs) > 0


def test_the_first_case_reaches_past_one_cell() -> None:
    # The cutoff reaches past one cell, so the pairs include images beyond the cell (the case is not trivial).
    case = NEIGHBOR_CASES[0]
    assert case.cutoff > min(sum(x * x for x in row) ** 0.5 for row in _structure_of(case).lattice)


@pytest.mark.parametrize("cutoff", [0.0, -1.0])
def test_a_cutoff_that_reaches_nothing_gives_no_pairs(cutoff: float) -> None:
    # The same as build_neighbor_graph: no pairs, while the supercell itself is still returned.
    from gemmy.compile.bonds import build_neighbor_graph

    case = NEIGHBOR_CASES[0]
    result = run([_neighbor_job(_structure_of(case), case, cutoff)])[0]
    assert "ok" in result, result
    assert result["ok"]["i"] == [] and result["ok"]["j"] == [] and result["ok"]["S"] == []
    assert result["ok"]["d"] == []
    atoms = _python_supercell(case)
    assert build_neighbor_graph(atoms, cutoff) == {}
    assert len(result["ok"]["positions"]) == len(atoms)


def test_mutating_the_input_after_construction_does_not_change_the_neighbours() -> None:
    # The source copied its structure and supercell, so the rows come from the supercell it was built with.
    case = NEIGHBOR_CASES[1]
    structure = _structure_json(_structure_of(case))
    args = [structure, list(case.supercell), list(case.periodic), case.cutoff]
    baseline, mutated = run(
        [
            {"fn": "neighborSnapshot", "args": args},
            {"fn": "neighborSnapshotAfterMutation", "args": args},
        ]
    )
    assert "ok" in baseline and "ok" in mutated, (baseline, mutated)
    # The mutated run reversed the atoms in its own copy of the structure, so compare against the unchanged read.
    assert mutated["ok"]["i"] == baseline["ok"]["i"]
    assert mutated["ok"]["j"] == baseline["ok"]["j"]
    assert mutated["ok"]["S"] == baseline["ok"]["S"]
    assert mutated["ok"]["symbols"] == baseline["ok"]["symbols"]
    assert _close(_flat(mutated["ok"]["positions"]), _flat(baseline["ok"]["positions"]), POSITION_TOLERANCE)


def test_the_runner_passes_null_and_names_what_json_would_change() -> None:
    # A null is a real value and comes back; undefined, NaN and typed arrays are errors that name their path.
    results = run([{"fn": "runnerValue", "args": [kind]} for kind in ("null", "undefined", "nan", "typed")])
    assert results[0] == {"ok": {"ref": None, "list": [None, 1]}}
    assert "undefined at job 1 (runnerValue)" in results[1]["error"]
    assert "non-finite number NaN at job 2 (runnerValue).fractional[1]" in results[2]["error"]
    assert "typed array at job 3 (runnerValue)" in results[3]["error"]
