"""The viewer's phone and wide breakpoints are literals in the CSS and the React classes, and one constant in
TypeScript (web/src/ui/layout-modes.ts). A literal that drifts from the constant would move a rule to another
width than the driver measures, so every literal near those widths must equal the constant it stands for."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
MODES = WEB / "src" / "ui" / "layout-modes.ts"
# A literal in this range is one of the two breakpoints (the phone's 640 px or the wide 641 px).
# The rest are other rules.
NEAR = range(600, 700)

# (max|min)-width: Npx in a media query, the Tailwind forms max-[Npx] and min-[Npx], and the theme's
# --breakpoint-wide.
LITERAL = re.compile(r"(max|min)-width:\s*(\d+)px|\b(max|min)-\[(\d+)px\]|--breakpoint-wide:\s*(\d+)px")


def _phone_width() -> int:
    match = re.search(r"export const PHONE_MAX_WIDTH = (\d+);", MODES.read_text(encoding="utf-8"))
    assert match, "layout-modes.ts names PHONE_MAX_WIDTH as a number"
    return int(match.group(1))


def _sources() -> list[Path]:
    return [
        WEB / "style.css",
        WEB / "tailwind.css",
        *sorted((WEB / "src").rglob("*.ts")),
        *sorted((WEB / "src").rglob("*.tsx")),
    ]


def _literals() -> list[tuple[Path, int, str, int]]:
    found = []
    for path in _sources():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in LITERAL.finditer(line):
                kind = match.group(1) or match.group(3)
                if match.group(5):
                    kind, value = "wide", int(match.group(5))
                elif match.group(2):
                    value = int(match.group(2))
                else:
                    value = int(match.group(4))
                if value in NEAR:
                    found.append((path, number, kind or "wide", value))
    return found


def test_each_phone_and_wide_literal_is_the_constant() -> None:
    phone = _phone_width()
    wide = phone + 1
    wrong = []
    literals = _literals()
    for path, number, kind, value in literals:
        expected = phone if kind == "max" else wide
        if value != expected:
            wrong.append(f"{path.relative_to(ROOT)}:{number} {kind} {value}px (the constant gives {expected}px)")
    assert not wrong, "breakpoint literals that differ from PHONE_MAX_WIDTH in layout-modes.ts:\n" + "\n".join(wrong)
    # The scan found the literals it is meant to check: the phone rule, the wide rule and the theme's breakpoint.
    kinds = {kind for _, _, kind, _ in literals}
    assert {"max", "min", "wide"} <= kinds, f"the scan found only {sorted(kinds)}"
