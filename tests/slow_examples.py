"""The examples whose compile takes over about a second. They are marked `slow`: the default run leaves them out and
`scripts/check.sh --slow` runs them. Tests that compile every example build their parameters with `example_param`."""

from __future__ import annotations

import pytest

SLOW_EXAMPLES = frozenset({"apoferritin", "nucleosome-1kx5", "nav17-6j8i"})


def example_param(name: str, *values: object):
    """pytest.param for example `name` with its other values, marked slow when the example is slow."""
    return pytest.param(name, *values, marks=pytest.mark.slow if name in SLOW_EXAMPLES else ())
