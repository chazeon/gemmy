"""The Cell section's large-cell limits (web/src/ui/load-budgets.ts): a supercell whose atoms pass the page's budget is
refused with the limit and the count, and an allowed one is not. Run in node through tests/viewer_bundle.py; skipped
without node."""

from __future__ import annotations

import pytest

from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")

# The apoferritin extxyz has 33,552 atoms in its cell: a 2x2x2 supercell is 268,416, past the page's 200,000.
APOFERRITIN_ATOMS = 33552
APOFERRITIN = "apoferritin.extxyz"


def test_a_supercell_past_the_atom_budget_is_refused_with_its_count_and_limit() -> None:
    problem = node_json(
        "const result = viewer.atomBudgetProblem(args[0], args[1], args[2]);", APOFERRITIN, APOFERRITIN_ATOMS, [2, 2, 2]
    )
    assert problem is not None
    assert "268416" in problem
    assert "200000" in problem
    assert "[2, 2, 2]" in problem


def test_the_unit_cell_of_a_large_structure_is_within_the_budget() -> None:
    problem = node_json(
        "const result = viewer.atomBudgetProblem(args[0], args[1], args[2]);", APOFERRITIN, APOFERRITIN_ATOMS, [1, 1, 1]
    )
    assert problem is None


def test_a_large_supercell_within_the_budget_is_allowed() -> None:
    # 33,552 x 2 x 2 x 1 = 134,208: large, but under the budget, so the page compiles it (with its busy state).
    problem = node_json(
        "const result = viewer.atomBudgetProblem(args[0], args[1], args[2]);", APOFERRITIN, APOFERRITIN_ATOMS, [2, 2, 1]
    )
    assert problem is None
