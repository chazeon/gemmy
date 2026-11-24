"""Skip `@pytest.mark.blender` tests unless bpy is importable (run them with `scripts/check.sh --blender`)."""

from __future__ import annotations

import importlib.util

import pytest


def pytest_collection_modifyitems(config, items) -> None:
    if importlib.util.find_spec("bpy") is not None:
        return
    skip = pytest.mark.skip(reason="bpy is not installed (scripts/check.sh --blender runs these)")
    for item in items:
        if "blender" in item.keywords:
            item.add_marker(skip)
