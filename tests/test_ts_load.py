"""The viewer's pure load helpers (web/src/ui/attempts.ts, load-budgets.ts, structure-load.ts, types-needed.ts,
scene/drop.ts): a load's attempt, the budgets, the saved-map cut and the sidecar names. Run in node through
tests/viewer_bundle.py; skipped without node."""

from __future__ import annotations

import pytest

from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")


def test_a_superseded_load_is_not_current() -> None:
    assert node_json("const result = viewer.attemptStory(args[0]);", ["load", "load"]) == [False, True]


def test_closing_the_tab_ends_its_load() -> None:
    assert node_json("const result = viewer.attemptStory(args[0]);", ["load", "close"]) == [False]
    assert node_json("const result = viewer.attemptStory(args[0]);", ["load"]) == [True]


def test_a_small_supercell_is_within_the_atom_budget() -> None:
    assert (
        node_json("const result = viewer.atomBudgetProblem(args[0], args[1], args[2]);", "ice.cif", 96, [1, 1, 1])
        is None
    )


def test_a_base_structure_past_the_budget_is_refused_before_its_bonds_are_derived() -> None:
    problem = node_json("const result = viewer.baseAtomBudgetProblem(args[0], args[1]);", "big.cif", 200_001)
    assert isinstance(problem, str)
    assert node_json("const result = viewer.baseAtomBudgetProblem(args[0], args[1]);", "ok.cif", 200_000) is None


def test_an_atom_budget_problem_names_the_supercell() -> None:
    problem = node_json(
        "const result = viewer.atomBudgetProblem(args[0], args[1], args[2]);", "big.cif", 1000, [20, 20, 20]
    )
    assert isinstance(problem, str)
    assert "cells.supercell" in problem
    assert "8000000" in problem


def test_the_atom_budget_counts_the_supercell_product() -> None:
    assert node_json("const result = viewer.expandedAtomCount(args[0], args[1]);", 10, [2, 3, 4]) == 240


def test_sidecars_within_the_budget_are_read_and_more_are_refused() -> None:
    assert node_json("const result = viewer.sidecarBudgetProblem(args[0]);", [1000, 2000]) is None
    assert "MB together" in node_json("const result = viewer.sidecarBudgetProblem(args[0]);", [60 * 1024 * 1024])


def test_a_load_error_is_named_by_its_file() -> None:
    named = "const result = viewer.namedMessage(args[0], args[1]);"
    assert node_json(named, "config.toml", "bad key") == "config.toml: bad key"
    assert node_json(named, "config.toml", "config.toml is not valid TOML") == "config.toml is not valid TOML"


def test_restrict_keeps_only_the_unresolved_types() -> None:
    result = node_json("const result = viewer.restrictMap(args[0], args[1]);", {"1": "Fe", "2": "O", "3": "Mg"}, [1, 3])
    assert result == {"1": "Fe", "3": "Mg"}


def test_a_sidecar_name_is_a_sidecar_whatever_the_structure_rule() -> None:
    sidecar = "const result = viewer.isSidecarName(args[0]);"
    assert node_json(sidecar, "POSCAR.toml") is True
    assert node_json(sidecar, "scene.json.gz") is True
    assert node_json(sidecar, "POSCAR") is False


def test_a_structure_name_is_grouped_and_a_sidecar_name_is_not() -> None:
    groups = node_json("const result = viewer.groupNames(args[0]);", ["POSCAR.toml", "POSCAR", "labels.json"])
    assert groups == {"structures": ["POSCAR"], "others": ["POSCAR.toml", "labels.json"]}
