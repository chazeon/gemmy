"""Which reader backend a run uses (src/gemmy/readers/selection.py): automatic choice by usability, GEMMY_READER, the
once-per-process choice and its reset. Missing and broken installs are simulated by monkeypatching the import."""

from __future__ import annotations

import sys
import warnings

import pytest

from gemmy.readers.selection import READER_ENV, READERS, active_reader_name, problem, reset_reader_choice


@pytest.fixture
def fresh_selection(monkeypatch):
    """Each test starts with no cached choice and no GEMMY_READER, and leaves none behind."""
    monkeypatch.delenv(READER_ENV, raising=False)
    reset_reader_choice()
    yield monkeypatch
    reset_reader_choice()


class _BrokenFastatoms:
    """A binding whose compiled module fails on first use."""

    def __getattr__(self, name):
        raise OSError("symbol not found in the compiled module")


def test_automatic_choice_is_fastatoms_when_it_is_usable(fresh_selection) -> None:
    expected = "fastatoms" if problem("fastatoms") is None else "ase"
    assert active_reader_name() == expected


def test_environment_name_is_stripped_and_empty_means_automatic(fresh_selection) -> None:
    fresh_selection.setenv(READER_ENV, "  ase \n")
    assert active_reader_name() == "ase"
    reset_reader_choice()
    fresh_selection.setenv(READER_ENV, "   ")
    assert active_reader_name() in READERS


def test_unknown_name_is_an_error_naming_the_choices(fresh_selection) -> None:
    fresh_selection.setenv(READER_ENV, "nope")
    with pytest.raises(ValueError, match="use one of"):
        active_reader_name()


def test_choice_is_kept_until_reset(fresh_selection) -> None:
    fresh_selection.setenv(READER_ENV, "ase")
    assert active_reader_name() == "ase"
    fresh_selection.setenv(READER_ENV, "nope")
    assert active_reader_name() == "ase"  # chosen once per process: the later environment is not read
    reset_reader_choice()
    with pytest.raises(ValueError, match="use one of"):
        active_reader_name()


def test_missing_fastatoms_falls_back_to_ase_silently(fresh_selection) -> None:
    """An ordinary install has no fastatoms: that is not a warning."""
    fresh_selection.setitem(sys.modules, "fastatoms", None)  # `import fastatoms` raises ModuleNotFoundError
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert active_reader_name() == "ase"
    assert [w for w in caught if issubclass(w.category, RuntimeWarning)] == []


def test_installed_but_broken_fastatoms_on_import_warns_and_falls_back(fresh_selection) -> None:
    """A package that is there but fails to import is broken, so the fallback names the cause."""

    class _ImportFails:
        def __getattr__(self, name):
            raise ImportError("libfastatoms.so: cannot open shared object file")

    fresh_selection.setitem(sys.modules, "fastatoms", _ImportFails())
    with pytest.warns(RuntimeWarning, match="fastatoms reader unusable"):
        assert active_reader_name() == "ase"


def test_broken_fastatoms_falls_back_to_ase_with_the_cause(fresh_selection) -> None:
    fresh_selection.setitem(sys.modules, "fastatoms", _BrokenFastatoms())
    with pytest.warns(RuntimeWarning, match="symbol not found"):
        assert active_reader_name() == "ase"


def test_fastatoms_that_lacks_a_format_is_unusable(fresh_selection) -> None:
    binding = pytest.importorskip("fastatoms")
    fresh_selection.setattr(binding, "available_formats", lambda: ["vasp", "xyz", "extxyz", "cif", "lammps-data"])
    cause = problem("fastatoms")
    assert cause is not None and "lammps-dump" in cause


def test_explicit_fastatoms_raises_with_the_cause(fresh_selection) -> None:
    fresh_selection.setenv(READER_ENV, "fastatoms")
    fresh_selection.setitem(sys.modules, "fastatoms", None)
    with pytest.raises(RuntimeError, match="GEMMY_READER=fastatoms.*not installed"):
        active_reader_name()


def test_explicit_fastatoms_with_a_broken_binding_raises(fresh_selection) -> None:
    fresh_selection.setenv(READER_ENV, "fastatoms")
    fresh_selection.setitem(sys.modules, "fastatoms", _BrokenFastatoms())
    with pytest.raises(RuntimeError, match="symbol not found"):
        active_reader_name()


def test_no_warning_when_fastatoms_is_usable(fresh_selection) -> None:
    if problem("fastatoms") is not None:
        pytest.skip("fastatoms is not usable here")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        active_reader_name()
