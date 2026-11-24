"""Both real and recording backends implement every Protocol method with the same parameters."""

from __future__ import annotations

import inspect

import pytest

from gemmy.render.blender import BlenderBackend
from gemmy.render.runner import Geometry, Stage
from recording import RecordingBackend


def _protocol_methods() -> list[str]:
    return [
        n
        for proto in (Geometry, Stage)
        for n, v in vars(proto).items()
        if inspect.isfunction(v) and not n.startswith("_")
    ]


@pytest.mark.parametrize("impl", [BlenderBackend, RecordingBackend], ids=lambda c: c.__name__)
def test_implements_protocol(impl: type) -> None:
    for name in _protocol_methods():
        owner = Geometry if hasattr(Geometry, name) else Stage
        want = inspect.signature(getattr(owner, name)).parameters
        assert hasattr(impl, name), f"{impl.__name__} lacks {name}"
        have = inspect.signature(getattr(impl, name)).parameters
        assert list(have) == list(want), f"{impl.__name__}.{name}: {list(have)} != {list(want)}"


def test_no_hasattr_backend_anywhere_in_src() -> None:
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "src"
    offenders = [str(p) for p in src.rglob("*.py") if "hasattr(backend" in p.read_text(encoding="utf-8")]
    assert offenders == []
