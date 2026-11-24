"""Helpers for golden-file comparison of compiled scenes.

Regenerate stored files deliberately with:
    GEMMY_UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py
and explain the change in the commit message.
"""

from __future__ import annotations

import json
import os
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
