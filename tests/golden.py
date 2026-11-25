"""Helpers for golden-file comparison of compiled scenes.

Regenerate stored files deliberately with:
    GEMMY_UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py
and explain the change in the commit message.
"""

from __future__ import annotations

import html
import json
import os
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parent / "fixtures"
DECIMALS = 6


def normalize(value: Any) -> Any:
    """Round floats, turn tuples into lists and drop -0.0 so output is stable across platforms."""
    if isinstance(value, float):
        rounded = round(value, DECIMALS)
        return 0.0 if rounded == 0 else rounded
    if isinstance(value, dict):
        return {str(k): normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(v) for v in value]
    return value


def dumps(value: Any) -> str:
    return json.dumps(normalize(value), indent=1, sort_keys=True) + "\n"


def updating() -> bool:
    return os.environ.get("GEMMY_UPDATE_GOLDEN") == "1"


def canonical_svg(text: str) -> str:
    """An SVG as stable text, for comparing exports: one element per line, namespaces dropped, attributes sorted,
    whitespace-only text dropped. Two SVGs that draw the same elements give the same text."""
    lines: list[str] = []

    def local(name: str) -> str:
        return name.rsplit("}", 1)[-1]

    def walk(element: ET.Element, depth: int) -> None:
        tag = local(element.tag)
        attrs = "".join(f' {local(k)}="{html.escape(v, quote=True)}"' for k, v in sorted(element.attrib.items()))
        text = (element.text or "").strip()
        pad = "  " * depth
        if len(element) == 0:
            lines.append(f"{pad}<{tag}{attrs}>{html.escape(text)}</{tag}>" if text else f"{pad}<{tag}{attrs}/>")
            return
        lines.append(f"{pad}<{tag}{attrs}>{html.escape(text)}")
        for child in element:
            walk(child, depth + 1)
        lines.append(f"{pad}</{tag}>")

    walk(ET.fromstring(text), 0)
    return "\n".join(lines) + "\n"
