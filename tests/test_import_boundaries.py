"""AST-based import boundary check between the compile and render halves.

Edit RULES when modules move. Paths are relative to src/gemmy.
  forbidden_anywhere: top-level package names that must not be imported at all (any scope).
  forbidden_toplevel: gemmy modules that must not be imported at module level
                      (lazy imports inside functions are allowed, e.g. builder -> compile).
"""

from __future__ import annotations

import ast
import unittest
from dataclasses import dataclass
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "gemmy"

HEAVY = frozenset({"ase", "numpy", "scipy", "pydantic", "tyro"})
COMPILE_MODULES = frozenset({"compile", "structure", "config"})


@dataclass(frozen=True)
class Rule:
    patterns: tuple[str, ...]  # glob patterns relative to src/gemmy
    forbidden_anywhere: frozenset[str] = frozenset()
    forbidden_toplevel: frozenset[str] = frozenset()


RULES = (
    # Scene and settings dataclasses and the whole render side: stdlib only, no compile dependencies.
    Rule(
        (
            "geom.py",
            "scene.py",
            "settings.py",
            "datafile.py",
            "view.py",
            "site.py",
            "serve.py",
            "render/*.py",
            "render/blender/*.py",
        ),
        forbidden_anywhere=HEAVY,
        forbidden_toplevel=COMPILE_MODULES,
    ),
    # Compile config and validation: pydantic is fine, the numeric stack is not.
    Rule(("config.py",), forbidden_toplevel=frozenset({"ase", "numpy", "scipy"})),
    # The tyro grammar may import tyro, never the heavy numeric stack or compile code at import time.
    Rule(("cli_args.py",), forbidden_toplevel=frozenset({"ase", "numpy", "scipy", "pydantic"}) | COMPILE_MODULES),
    # Entry points may reach compile code lazily, never at import time.
    Rule(("cli.py", "__init__.py"), forbidden_toplevel=HEAVY | COMPILE_MODULES),
)


def _imports(tree: ast.AST, toplevel_only: bool) -> list[tuple[str, int]]:
    """Return (dotted target, level) for each import; relative imports use the module name."""
    found: list[tuple[str, int]] = []

    def visit(node: ast.AST, in_function: bool) -> None:
        for child in ast.iter_child_nodes(node):
            nested = in_function or isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
            if isinstance(child, ast.Import):
                if not (toplevel_only and in_function):
                    found.extend((alias.name, 0) for alias in child.names)
            elif isinstance(child, ast.ImportFrom):
                if not (toplevel_only and in_function):
                    found.append((child.module or "", child.level))
                    if child.level and not child.module:
                        found.extend((alias.name, child.level) for alias in child.names)
            visit(child, nested)

    visit(tree, False)
    return found


def _root_name(target: str) -> str:
    # Relative imports (level >= 1) refer to gemmy modules: ".scene" -> "scene".
    return target.split(".")[0]


class TestImportBoundaries(unittest.TestCase):
    def test_rules_cover_existing_files(self) -> None:
        for rule in RULES:
            for pattern in rule.patterns:
                self.assertTrue(list(SRC.glob(pattern)), f"rule pattern matches nothing: {pattern}")

    def test_boundaries(self) -> None:
        violations: list[str] = []
        for rule in RULES:
            for pattern in rule.patterns:
                for path in sorted(SRC.glob(pattern)):
                    tree = ast.parse(path.read_text(encoding="utf-8"))
                    for target, level in _imports(tree, toplevel_only=False):
                        if level == 0 and _root_name(target) in rule.forbidden_anywhere:
                            violations.append(f"{path.name}: imports {target}")
                    for target, level in _imports(tree, toplevel_only=True):
                        root = _root_name(target)
                        if level >= 1 and root in rule.forbidden_toplevel:
                            violations.append(f"{path.name}: top-level import of compile module {target}")
                        if level == 0 and root in HEAVY and root in rule.forbidden_toplevel:
                            violations.append(f"{path.name}: top-level import of {target}")
        self.assertEqual(violations, [])

    def test_checker_detects_violations(self) -> None:
        tree = ast.parse("import numpy\nfrom .scene import x\ndef f():\n    import ase\n")
        self.assertEqual(len(_imports(tree, toplevel_only=False)), 3)
        self.assertEqual(len(_imports(tree, toplevel_only=True)), 2)


if __name__ == "__main__":
    unittest.main()
