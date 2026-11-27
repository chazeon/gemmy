"""The reader contract (docs/plans/reader-contract.md) on the synthetic cases in tests/fixtures/reader-contract. Each
case's folder holds one input file and an expected.json: the lattice rows, the elements, style keys and fractional
coordinates a read gives, or an `error` substring. Every available Python backend and the page's TypeScript reader
(fastatoms in wasm, via tests/ts_bundle.py) must give that result. The page gets the file's raw bytes and decodes them
itself, as the page does. A backend that cannot meet a rule is a strict expected failure, named by its rule.
Skips: a backend that is not installed, and node without web/node_modules (as in the other node tests)."""

from __future__ import annotations

import base64
import functools
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from gemmy.readers.selection import READERS, problem
from ts_bundle import available as node_available
from ts_bundle import run

CASES_DIR = Path(__file__).resolve().parent / "fixtures" / "reader-contract"
ROUND_DIGITS = 6
PYTHON_READERS = tuple(READERS)
# (reader, case) -> the rule the reader does not meet yet, and why. A strict expected failure: when the reader starts to
# meet it, the test reports XPASS and the entry is removed.
EXPECTED_FAILURES: dict[tuple[str, str], str] = {}


@dataclass(frozen=True)
class Case:
    name: str
    path: Path
    types: dict[int, str] | None
    expected: dict[str, Any]

    @property
    def rule(self) -> str:
        return self.name.split("-", 1)[0]


def _cases() -> list[Case]:
    cases = []
    for folder in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        expected = json.loads((folder / "expected.json").read_text(encoding="utf-8"))
        inputs = [p for p in folder.iterdir() if p.name not in ("expected.json", "README.md")]
        assert len(inputs) == 1, f"{folder.name}: one input file expected, found {[p.name for p in inputs]}"
        types = expected.get("types")
        cases.append(
            Case(
                name=folder.name,
                path=inputs[0],
                types=None if types is None else {int(k): v for k, v in types.items()},
                expected=expected,
            )
        )
    return cases


CASES = _cases()


def _rounded(values) -> list:
    """Each number rounded to ROUND_DIGITS, with -0.0 made 0.0, so a read and the expected file compare equal."""
    return [[round(x, ROUND_DIGITS) + 0.0 for x in row] for row in values]


def _summary(lattice, elements, style_keys, fractional) -> dict[str, Any]:
    return {
        "lattice": _rounded(lattice),
        "elements": list(elements),
        "style_keys": list(style_keys),
        "fractional": _rounded(fractional),
    }


def _outcome_from_python(case: Case, reader: str) -> dict[str, Any]:
    """The read of the case as a comparable dict: lattice, elements, style keys and fractional coordinates, or error."""
    try:
        structure = READERS[reader].read(case.path, case.types or {})
    except Exception as exc:  # the error is what the case checks
        return {"error": str(exc)}
    return _summary(
        structure.lattice,
        [a.element for a in structure.atoms],
        [a.style_key for a in structure.atoms],
        [a.fractional for a in structure.atoms],
    )


def _ts_job(case: Case) -> dict[str, Any]:
    """The page's job: the file's raw bytes (base64), decoded by the page's own decoder in the bundle."""
    options: dict[str, Any] = {"fileName": case.path.name}
    if case.types:
        options["configTypes"] = {str(k): v for k, v in case.types.items()}
    raw = base64.b64encode(case.path.read_bytes()).decode("ascii")
    return {"fn": "readStructureFromBase64", "args": [raw, options]}


@functools.cache
def _ts_outcomes() -> dict[str, dict[str, Any]]:
    """The page's reader on every case, from one node process."""
    results = run([_ts_job(case) for case in CASES])
    outcomes = {}
    for case, result in zip(CASES, results, strict=True):
        if "error" in result:
            outcomes[case.name] = {"error": result["error"]}
            continue
        structure = result["ok"]["structure"]
        outcomes[case.name] = _summary(
            structure["lattice"],
            [a["element"] for a in structure["atoms"]],
            [a["styleKey"] for a in structure["atoms"]],
            [a["fractional"] for a in structure["atoms"]],
        )
    return outcomes


def _check(case: Case, outcome: dict[str, Any]) -> None:
    """Holds an outcome to the case's expected result."""
    expected = case.expected
    if "error" in expected:
        assert "error" in outcome, f"expected an error naming {expected['error']!r}, got {outcome}"
        assert expected["error"] in outcome["error"], outcome["error"]
        return
    assert "error" not in outcome, outcome["error"]
    assert outcome["lattice"] == _rounded(expected["lattice"])
    assert outcome["elements"] == expected["elements"]
    assert outcome["style_keys"] == expected["style_keys"]
    assert outcome["fractional"] == expected["fractional"]


def _marks(reader: str, case: Case) -> list:
    reason = EXPECTED_FAILURES.get((reader, case.name))
    return [pytest.mark.xfail(strict=True, reason=reason)] if reason else []


def _python_params() -> list:
    params = []
    for reader in PYTHON_READERS:
        cause = problem(reader)
        if cause is not None:
            params.append(pytest.param(reader, None, id=f"{reader}-unusable", marks=pytest.mark.skip(reason=cause)))
            continue
        params += [pytest.param(reader, case, id=f"{reader}-{case.name}", marks=_marks(reader, case)) for case in CASES]
    return params


@pytest.mark.parametrize(("reader", "case"), _python_params())
def test_python_reader_meets_the_contract(reader: str, case: Case | None) -> None:
    _check(case, _outcome_from_python(case, reader))


@pytest.mark.skipif(not node_available(), reason="node or web/node_modules is missing (cd web && npm ci)")
@pytest.mark.parametrize("case", [pytest.param(c, id=f"page-{c.name}", marks=_marks("page", c)) for c in CASES])
def test_page_reader_meets_the_contract(case: Case) -> None:
    _check(case, _ts_outcomes()[case.name])


@pytest.mark.skipif(not node_available(), reason="node or web/node_modules is missing (cd web && npm ci)")
@pytest.mark.skipif(problem("fastatoms") is not None, reason="fastatoms is not usable here (uv sync --group fastatoms)")
@pytest.mark.parametrize("case", [pytest.param(c, id=c.name, marks=_marks("fastatoms-page", c)) for c in CASES])
def test_fastatoms_matches_the_page(case: Case) -> None:
    """The fastatoms binding and the page's fastatoms reader give the same read on every case."""
    python, page = _outcome_from_python(case, "fastatoms"), _ts_outcomes()[case.name]
    if "error" in python or "error" in page:
        assert "error" in python and "error" in page, (python, page)
    else:
        assert python == page


def test_ase_only_formats_are_read_by_ase(tmp_path: Path) -> None:
    """R14: a format outside the five (here ASE's own trajectory format) is read by the ASE backend, by ASE's guess."""
    from ase.build import bulk  # type: ignore

    traj = tmp_path / "bulk.traj"
    from ase.io import write  # type: ignore

    atoms = bulk("NaCl", "rocksalt", a=4.0)
    write(traj, atoms)
    structure = READERS["ase"].read(traj, {})
    assert sorted(a.element for a in structure.atoms) == sorted(atoms.get_chemical_symbols())
