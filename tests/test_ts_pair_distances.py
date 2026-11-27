"""The structure facts of the style panel (web/src/compile/pair-distances.ts): the distances of each element pair up to
a cutoff, the histogram of those distances, and the names a rule can use. They run in the node bridge
(tests/ts_bundle.py), which reads the structure with the same reader as the page.

The expected distances are worked out here from the lattice. Rock-salt MgO with a = 4.2 A has Mg-O at (a/2) * sqrt(N)
for the N whose offsets sum to an odd number, and Mg-Mg and O-O at (a/2) * sqrt(N) for the even ones. The
stishovite-type SiO2 cell is synthetic (no stishovite fixture is committed): a rutile-type cell with a = 4.1771,
c = 2.6703 and u = 0.3064, which gives Si-O 1.758 A (two apical bonds) and 1.810 A (four equatorial bonds).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from ts_bundle import available, run

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
ROCKSALT = FIXTURES / "rocksalt" / "POSCAR"
LABELS = FIXTURES / "labels" / "POSCAR"
DUMMY_LABEL = FIXTURES / "structures" / "dummy-label" / "POSCAR"
ROCKSALT_A = 4.2
ONE_CELL = [1, 1, 1]
PERIODIC = [True, True, True]
DISTANCE_ABS = 1e-9

# Synthetic rutile-type SiO2 (one cell, six atoms). Oxygen sits at (u, u, 0) and (1/2 + u, 1/2 - u, 1/2) and their
# images, here as fractional coordinates wrapped into the cell.
STISHOVITE_LIKE = """Synthetic rutile-type SiO2 (stishovite-like, test fixture)
1.0
4.1771 0.0 0.0
0.0 4.1771 0.0
0.0 0.0 2.6703
Si O
2 4
Direct
0.0 0.0 0.0
0.5 0.5 0.5
0.3064 0.3064 0.0
0.6936 0.6936 0.0
0.8064 0.1936 0.5
0.1936 0.8064 0.5
"""


def pair(first: str, second: str) -> str:
    """The key of an element pair (elementPairKey): JSON of the two names, lower atomic number first."""
    return json.dumps([first, second], separators=(",", ":"))


def _ok(result: dict[str, Any]) -> Any:
    assert "ok" in result, f"{result.get('type')}: {result.get('error')}"
    return result["ok"]


def pair_distances(text: str, cutoff: float, file_name: str = "POSCAR", supercell=ONE_CELL, periodic=PERIODIC):
    (result,) = run([{"fn": "pairDistanceRows", "args": [text, file_name, cutoff, list(supercell), list(periodic)]}])
    return _ok(result)


def rocksalt_text() -> str:
    return ROCKSALT.read_text(encoding="utf-8")


def assert_distances(actual: list[float], expected: list[float], abs_tol: float = DISTANCE_ABS) -> None:
    assert len(actual) == len(expected), f"{actual} != {expected}"
    for got, want in zip(actual, expected, strict=True):
        assert got == pytest.approx(want, abs=abs_tol), f"{actual} != {expected}"


pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")


# ---- pair distances -------------------------------------------------------------------------------------------------


def test_rocksalt_pairs_up_to_the_cutoff_are_sorted_distinct_and_keyed_by_symbol_order() -> None:
    """O-Mg shells: a/2 and (a/2)sqrt(3). Mg-Mg and O-O: (a/2)sqrt(2) and a. The next shells, (a/2)sqrt(5) for O-Mg and
    (a/2)sqrt(6) for like pairs, lie beyond the cutoff of 4.5 A."""
    half = ROCKSALT_A / 2
    distances = pair_distances(rocksalt_text(), 4.5)
    assert sorted(distances) == sorted([pair("Mg", "Mg"), pair("O", "Mg"), pair("O", "O")])
    assert_distances(distances[pair("O", "Mg")], [half, half * math.sqrt(3)])
    assert_distances(distances[pair("Mg", "Mg")], [half * math.sqrt(2), ROCKSALT_A])
    assert_distances(distances[pair("O", "O")], [half * math.sqrt(2), ROCKSALT_A])


def test_a_cutoff_inside_the_first_shell_keeps_only_the_nearest_pair() -> None:
    """Six O-Mg pairs at a/2 (each seen from both atoms) are one distance: the repeats are dropped."""
    distances = pair_distances(rocksalt_text(), 2.5)
    assert sorted(distances) == [pair("O", "Mg")]
    assert_distances(distances[pair("O", "Mg")], [ROCKSALT_A / 2])


def test_a_zero_cutoff_gives_no_pairs() -> None:
    assert pair_distances(rocksalt_text(), 0.0) == {}


def test_stishovite_like_si_o_distances_are_1_758_and_1_810() -> None:
    """Two apical and four equatorial Si-O bonds from each Si. The O-O distances are longer than the 2.0 A cutoff."""
    distances = pair_distances(STISHOVITE_LIKE, 2.0)
    assert sorted(distances) == [pair("O", "Si")]
    assert_distances(distances[pair("O", "Si")], [1.758, 1.810], abs_tol=5e-4)


def test_pairs_are_keyed_with_the_smaller_symbol_first() -> None:
    """Keys run in atomic-number order: O (8) before Mg (12) and Si (14), not the string order Mg-O and Si-O."""
    assert pair("O", "Mg") in pair_distances(rocksalt_text(), 2.5)
    assert pair("Mg", "O") not in pair_distances(rocksalt_text(), 2.5)
    assert pair("O", "Si") in pair_distances(STISHOVITE_LIKE, 2.0)


def test_a_supercell_gives_the_same_distances_as_the_cell() -> None:
    """Pairs across the cell boundary come from the image atoms, so a 2x2x2 supercell holds the same shells."""
    cell = pair_distances(rocksalt_text(), 4.5)
    supercell = pair_distances(rocksalt_text(), 4.5, supercell=[2, 2, 2])
    assert sorted(supercell) == sorted(cell)
    for key in cell:
        assert_distances(supercell[key], cell[key])


MIXED_RINGS = FIXTURES / "mixed-labels" / "rings" / "POSCAR"


def test_a_label_and_its_element_are_different_pairs() -> None:
    """C and C_dna are both carbon, yet their pairs are keyed by label: C-C, C-C_dna and C_dna-C_dna, each name once."""
    distances = pair_distances(MIXED_RINGS.read_text(encoding="utf-8"), 2.0)
    assert sorted(distances) == sorted([pair("C", "C"), pair("C", "C_dna"), pair("C_dna", "C_dna")])
    assert_distances(distances[pair("C", "C")], [1.39], abs_tol=1e-5)
    assert_distances(distances[pair("C", "C_dna")], [1.61], abs_tol=1e-5)


def test_names_of_a_mixed_structure_are_its_labels() -> None:
    assert present_names(MIXED_RINGS) == ["C", "C_dna"]


def test_dummy_atoms_are_left_out_of_the_pairs() -> None:
    """A dummy X atom pairs with nothing: no key names it, whatever its distance."""
    distances = pair_distances(DUMMY_LABEL.read_text(encoding="utf-8"), 4.0, file_name="POSCAR")
    assert distances
    assert all("X" not in key.split("-") for key in distances)


# ---- the histogram ------------------------------------------------------------------------------------------------


def histogram(distances: list[float], bins: int) -> dict[str, Any]:
    (result,) = run([{"fn": "distanceHistogram", "args": [distances, bins]}])
    return _ok(result)


def test_histogram_bins_cover_the_range_and_the_top_distance_is_in_the_last_bin() -> None:
    result = histogram([1.0, 1.5, 2.0, 2.5, 3.0], 2)
    assert result["edges"] == pytest.approx([1.0, 2.0, 3.0])
    assert result["counts"] == [2, 3]


def test_histogram_counts_every_distance_once() -> None:
    distances = [d for values in pair_distances(rocksalt_text(), 4.5).values() for d in values]
    result = histogram(distances, 5)
    assert len(result["edges"]) == 6
    assert sum(result["counts"]) == len(distances)


def test_histogram_of_one_distance_fills_the_first_bin() -> None:
    result = histogram([2.1], 4)
    assert result["counts"] == [1, 0, 0, 0]
    assert result["edges"] == pytest.approx([2.1, 2.35, 2.6, 2.85, 3.1])


def test_histogram_of_no_distances_is_empty_bins_over_zero_to_one() -> None:
    result = histogram([], 3)
    assert result["counts"] == [0, 0, 0]
    assert result["edges"] == pytest.approx([0.0, 1 / 3, 2 / 3, 1.0])


def test_histogram_needs_a_whole_number_of_bins() -> None:
    (result,) = run([{"fn": "distanceHistogram", "args": [[1.0, 2.0], 0]}])
    assert "error" in result
    assert result["type"] == "RangeError"


# ---- the names a rule can use -------------------------------------------------------------------------------------


def present_names(path: Path) -> list[str]:
    (result,) = run([{"fn": "presentNamesOf", "args": [path.read_text(encoding="utf-8"), "POSCAR"]}])
    return _ok(result)


def test_names_of_the_labels_fixture_are_its_labels() -> None:
    """Al, O and the two hydrogen labels H1 and H2 the POSCAR gives its species. The element H is no name of its own."""
    assert present_names(LABELS) == ["Al", "H1", "H2", "O"]


def test_names_of_rocksalt_are_its_elements() -> None:
    assert present_names(ROCKSALT) == ["Mg", "O"]


def _dense_text(atoms: int, edge: float) -> str:
    """Atoms at seeded random points of an edge-sized cube: at a 4 A cutoff a 1 A cube has about 1e8 pairs."""
    import random

    rng = random.Random(11)
    points = [f"{rng.uniform(0, edge):.4f} {rng.uniform(0, edge):.4f} {rng.uniform(0, edge):.4f}" for _ in range(atoms)]
    return "\n".join(
        [
            "Dense synthetic cluster",
            "1.0",
            f"{edge} 0.0 0.0",
            f"0.0 {edge} 0.0",
            f"0.0 0.0 {edge}",
            "Mg O",
            f"{atoms // 2} {atoms - atoms // 2}",
            "Cartesian",
            *points,
            "",
        ]
    )


def test_a_dense_cell_stops_at_the_pair_budget_and_is_partial() -> None:
    """10k atoms in 1 A^3 would be about 1e8 pairs at 4 A: the read stops at MAX_HISTOGRAM_PAIRS (a shorter reach, and
    marked partial), so it returns quickly. The time is printed with -s."""
    import time

    started = time.perf_counter()
    (result,) = run(
        [
            {
                "fn": "pairDistanceRead",
                "args": [_dense_text(10_000, 1.0), "POSCAR", 4.0, [1, 1, 1], [False, False, False]],
            }
        ]
    )
    elapsed = time.perf_counter() - started
    print(f"\ndense 10k-atom pair read: {elapsed:.2f} s, partial={result.get('ok', {}).get('partial')}")
    assert "ok" in result, result.get("error")
    assert result["ok"]["partial"] is True
    assert elapsed < 30


def test_a_normal_cell_is_not_partial() -> None:
    (result,) = run(
        [{"fn": "pairDistanceRead", "args": [ROCKSALT.read_text(encoding="utf-8"), "POSCAR", 4.0, [2, 2, 2], PERIODIC]}]
    )
    assert "ok" in result, result.get("error")
    assert result["ok"]["partial"] is False
