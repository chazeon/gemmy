"""Import and reference boundaries of the TypeScript compile side, checked from the source text: web/src/structure
(the reader), web/src/compile (the stages) and the vendored fastatoms under web/vendor. Python's twin is
tests/test_import_boundaries.py.

Edit RULES when modules move. Paths in a rule are relative to web/ (so "src/react" names the directory and
"src/structure/fastatoms.ts" a file). Every import is first canonicalised (its path resolved against the importing
file, the extension and a trailing index dropped), so "../structure/fastatoms" and "../structure/fastatoms.ts" are the
same target, and an alias "@/x" is "src/x". A bare name is a package.
"""

from __future__ import annotations

import os
import re
import unittest
from dataclasses import dataclass
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"

# Statements that import or re-export, found over the whole file so a statement may span lines and need no semicolon:
# `import ... from "x"`, `export ... from "x"` (the clause holds no quote, parenthesis or equals sign, so it cannot run
# into another statement), `import "x"`, `import("x")` and `require("x")`.
IMPORT_RE = re.compile(
    r"\b(?:import|export)\b(?:\s+type)?\s*(?:[\w$*{},\s]*?\bfrom\s*)?[\"']([^\"'\n]+)[\"']"
    r"|\bimport\s*\(\s*[\"']([^\"'\n]+)[\"']\s*\)"
    r"|\brequire\s*\(\s*[\"']([^\"'\n]+)[\"']\s*\)"
)
# Comments are not code: a note that mentions an import or a DOM global does not count.
BLOCK_COMMENT_RE = re.compile(r"/\*[\s\S]*?\*/")
LINE_COMMENT_RE = re.compile(r"//[^\n]*")
DOM_NAMES = r"(?:document|window|navigator|localStorage|sessionStorage|location)"
# A DOM global used as a name: `document.`, `window?.`, `localStorage[`. A property of an object (`frame.location`) is
# not a global, so the name must not follow a dot or a word character. The same names reached through `globalThis`
# (or `self`) count too: `globalThis.document`, `globalThis?.window`, `globalThis["window"]`.
DOM_REF_RE = re.compile(
    rf"(?<![\w.$])({DOM_NAMES})\s*[.?\[]"
    rf"|\b(?:globalThis|self)\s*(?:\?\.\s*|\.\s*|\[\s*[\"']\s*)({DOM_NAMES})\b"
)

DOM_REFS = frozenset({DOM_REF_RE.pattern})
PURE = "src/structure/**/*.ts", "src/compile/**/*.ts"
# Every TypeScript file of the page and its tests, including the ones a rule does not name.
ALL_SOURCE = "src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"
EXTENSIONS = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs")


@dataclass(frozen=True)
class Rule:
    patterns: tuple[str, ...]  # globs relative to web/
    forbidden_packages: frozenset[str] = frozenset()  # bare imports: "react" also covers "react/jsx-runtime"
    forbidden_paths: frozenset[str] = frozenset()  # canonical imports: a directory covers everything under it
    forbidden_refs: frozenset[str] = frozenset()  # regular expressions over the code (comments removed)
    exempt: frozenset[str] = frozenset()  # globs (web-relative) of the files the rule does not apply to


RULES = (
    # No DOM, no three, no React: the reader and the stages run in node and under the page's own tests.
    Rule(
        PURE,
        forbidden_packages=frozenset({"three", "react", "react-dom"}),
        forbidden_paths=frozenset({"src/react", "src/ui", "src/components"}),
        forbidden_refs=DOM_REFS,
    ),
    # Only the reader imports the vendored fastatoms, everywhere in the page and its tests. web/src/compiler/ (the
    # compiler entry) reaches fastatoms through structure/fastatoms.ts, which is the one file allowed to import it.
    Rule(ALL_SOURCE, forbidden_paths=frozenset({"vendor/fastatoms"}), exempt=frozenset({"src/structure/fastatoms.ts"})),
    # Only the Tweakpane files draw with Tweakpane: the adapter, and the plugins it registers (tweakpane-*.ts in the
    # style panel). The section descriptions (react/style-panel/pane-model.ts) are plain data, so the panel's library
    # can change in those files alone.
    Rule(
        ALL_SOURCE,
        forbidden_packages=frozenset({"tweakpane", "@tweakpane/plugin-essentials", "@tweakpane/core"}),
        exempt=frozenset({"src/react/style-panel/tweakpane-*.ts"}),
    ),
    # The stages take a NeighborSource (structure.ts), never the wasm reader itself.
    Rule(("src/compile/**/*.ts",), forbidden_paths=frozenset({"src/structure/fastatoms"})),
)


def code_of(text: str) -> str:
    return LINE_COMMENT_RE.sub("", BLOCK_COMMENT_RE.sub("", text))


def imports_of(text: str) -> list[str]:
    return [next(group for group in match.groups() if group) for match in IMPORT_RE.finditer(code_of(text))]


def canonical(spec: str, importer: Path) -> str:
    """The import as a path relative to web/, without its extension or a trailing index (or the bare package name)."""
    if spec.startswith("."):
        path = os.path.relpath(os.path.normpath(importer.parent / spec), WEB).replace(os.sep, "/")
    elif spec.startswith("@/"):
        path = f"src/{spec[2:]}"
    else:
        return spec
    for extension in EXTENSIONS:
        if path.endswith(extension):
            path = path[: -len(extension)]
            break
    if path.endswith("/index"):
        path = path[: -len("/index")]
    return path


def glob_matches(relative: str, pattern: str) -> bool:
    """Whether a web-relative path matches a glob: `*` within one directory, `**/` any number of them."""
    regex = re.escape(pattern).replace(r"\*\*/", "(?:.*/)?").replace(r"\*", "[^/]*")
    return re.fullmatch(regex, relative) is not None


def _under(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def violations_in(importer: Path, text: str, rules: tuple[Rule, ...]) -> list[str]:
    """The rule breaches of one file: its imports and references, checked against each rule that covers it."""
    relative = os.path.relpath(importer, WEB).replace(os.sep, "/")
    found: list[str] = []
    specs = imports_of(text)
    refs = code_of(text)
    for rule in rules:
        if any(glob_matches(relative, p) for p in rule.exempt):
            continue
        if not any(glob_matches(relative, p) for p in rule.patterns):
            continue
        for spec in specs:
            target = canonical(spec, importer)
            if spec.startswith(".") or spec.startswith("@/"):
                hit = any(_under(target, prefix) for prefix in rule.forbidden_paths)
            else:
                hit = any(_under(spec, package) for package in rule.forbidden_packages)
                hit = hit or any(_under(target, prefix) for prefix in rule.forbidden_paths)
            if hit:
                found.append(f"{relative}: imports {spec}")
        for pattern in rule.forbidden_refs:
            for match in re.finditer(pattern, refs):
                found.append(f"{relative}: references {match.group(0)}")
    return found


def source_files() -> list[Path]:
    files: set[Path] = set()
    for pattern in ALL_SOURCE:
        files.update(WEB.glob(pattern))
    return sorted(files)


class TestTsBoundaries(unittest.TestCase):
    def test_rules_cover_existing_files(self) -> None:
        for rule in RULES:
            for pattern in rule.patterns:
                self.assertTrue(list(WEB.glob(pattern)), f"rule pattern matches nothing: {pattern}")

    def test_boundaries(self) -> None:
        violations: list[str] = []
        for path in source_files():
            violations += violations_in(path, path.read_text(encoding="utf-8"), RULES)
        self.assertEqual(violations, [])

    def test_checker_detects_violations(self) -> None:
        importer = WEB / "src" / "structure" / "sample.ts"
        text = (
            'import { x } from "three";\n'
            "import {\n  y,\n} from '@/react/overlay';\n"
            'export * from "../../vendor/fastatoms/index.js";\n'
            '// import z from "react";\n'
            "const cell = document.body;\n"
            'const later = window.location; // from "three"\n'
            "const nav = navigator.userAgent;\n"
            'const store = localStorage["key"];\n'
            "const here = frame.location.href; // document.body\n"
            "const note = 1; // window.open\n"
        )
        found = violations_in(importer, text, RULES)
        self.assertIn("src/structure/sample.ts: imports three", found)
        self.assertIn("src/structure/sample.ts: imports @/react/overlay", found)
        self.assertIn("src/structure/sample.ts: imports ../../vendor/fastatoms/index.js", found)
        self.assertNotIn("src/structure/sample.ts: imports react", found)
        self.assertIn("src/structure/sample.ts: references document.", found)
        self.assertIn("src/structure/sample.ts: references window.", found)
        self.assertIn("src/structure/sample.ts: references navigator.", found)
        self.assertIn("src/structure/sample.ts: references localStorage[", found)
        self.assertEqual(len(found), 7)  # the property `frame.location` and the trailing comments are not references

    def test_only_the_style_panels_tweakpane_files_import_tweakpane(self) -> None:
        panel_plugin = WEB / "src" / "react" / "style-panel" / "tweakpane-range-histogram.ts"
        self.assertEqual(violations_in(panel_plugin, 'import { Pane } from "tweakpane";\n', RULES), [])
        inspector = WEB / "src" / "react" / "inspector" / "tweakpane-widget.ts"
        self.assertEqual(len(violations_in(inspector, 'import { Pane } from "tweakpane";\n', RULES)), 1)
        model = WEB / "src" / "react" / "style-panel" / "pane-model.ts"
        self.assertEqual(len(violations_in(model, 'import { Pane } from "tweakpane";\n', RULES)), 1)

    def test_the_reader_alone_may_import_the_vendor_package(self) -> None:
        reader = WEB / "src" / "structure" / "fastatoms.ts"
        vendored = 'import { read } from "../../vendor/fastatoms/index.js";\n'
        self.assertEqual(violations_in(reader, vendored, RULES), [])
        other = WEB / "src" / "structure" / "readers.ts"
        self.assertEqual(len(violations_in(other, vendored, RULES)), 1)
        # The supercell source (neighbors.ts) reaches the wasm only through fastatoms.ts's exports.
        supercell_source = WEB / "src" / "structure" / "neighbors.ts"
        self.assertEqual(len(violations_in(supercell_source, vendored, RULES)), 1)
        compile_side = WEB / "src" / "compile" / "bonds.ts"
        leaked = 'import { Atoms } from "../../vendor/fastatoms/index.js";\n'
        self.assertEqual(len(violations_in(compile_side, leaked, RULES)), 1)

    def test_a_relative_path_to_the_reader_is_canonicalised(self) -> None:
        # ../structure/fastatoms from compile/ is the forbidden file, however the import is spelled.
        compile_side = WEB / "src" / "compile" / "bonds.ts"
        for spelling in ('"../structure/fastatoms"', '"../structure/fastatoms.ts"', '"../structure/fastatoms.js"'):
            text = f"import {{ readStructure }} from {spelling};\n"
            self.assertEqual(len(violations_in(compile_side, text, RULES)), 1, spelling)

    def test_the_compiler_entry_may_import_the_reader_but_not_the_vendor(self) -> None:
        entry = WEB / "src" / "compiler" / "entry.ts"
        self.assertEqual(violations_in(entry, 'import { readStructure } from "../structure/fastatoms";\n', RULES), [])
        direct = 'import { read } from "../../vendor/fastatoms/index.js";\n'
        self.assertEqual(len(violations_in(entry, direct, RULES)), 1)

    def test_the_test_entry_may_import_the_reader_but_not_the_vendor(self) -> None:
        entry = WEB / "test" / "compile-entry.ts"
        self.assertEqual(violations_in(entry, 'export * from "../src/structure/fastatoms";\n', RULES), [])
        self.assertEqual(len(violations_in(entry, 'import { init } from "../vendor/fastatoms/index.js";\n', RULES)), 1)

    def test_the_vendor_rule_covers_tsx_and_tests(self) -> None:
        tsx = WEB / "src" / "react" / "overlay.tsx"
        self.assertEqual(len(violations_in(tsx, 'import { read } from "../../vendor/fastatoms/index.js";\n', RULES)), 1)

    def test_multi_line_semicolonless_and_side_effect_imports_are_caught(self) -> None:
        importer = WEB / "src" / "compile" / "bonds.ts"
        cases = {
            "multi-line import": 'import {\n  three,\n  other\n} from "three"\n',
            "semicolonless import": 'import { x } from "three"\nconst y = 1\n',
            "multi-line re-export": 'export {\n  a,\n  b\n}\nfrom "three"\n',
            "side-effect import": 'import "three"\n',
            "dynamic import": 'const mod = await import("three")\n',
            "require": 'const mod = require("three")\n',
            "import equals require": 'import mod = require("three")\n',
            "type-only import": 'import type { T } from "three"\n',
        }
        for label, text in cases.items():
            self.assertEqual(len(violations_in(importer, text, RULES)), 1, label)

    def test_a_statement_is_not_joined_to_the_next_one(self) -> None:
        # The clause of an import cannot run into a later statement: the second line's `from` belongs to nothing here.
        importer = WEB / "src" / "compile" / "bonds.ts"
        text = 'export const label = "x"\nconst from = 1\nexport { a } from "./bonds"\n'
        self.assertEqual(violations_in(importer, text, RULES), [])

    def test_globalthis_and_self_references_are_caught(self) -> None:
        importer = WEB / "src" / "structure" / "sample.ts"
        cases = {
            "globalThis.document": "const body = globalThis.document.body;\n",
            "globalThis?.window": "const w = globalThis?.window;\n",
            "globalThis bracket": 'const w = globalThis["window"];\n',
            "self.document": "const d = self.document;\n",
        }
        for label, text in cases.items():
            self.assertEqual(len(violations_in(importer, text, RULES)), 1, label)

    def test_comments_and_properties_are_not_flagged(self) -> None:
        importer = WEB / "src" / "structure" / "sample.ts"
        text = (
            '/* import x from "three"; document.body */\n'
            "// globalThis.window.open\n"
            "const url = frame.location.href;\n"
            "const sized = frame.document.title;\n"
        )
        self.assertEqual(violations_in(importer, text, RULES), [])


if __name__ == "__main__":
    unittest.main()
