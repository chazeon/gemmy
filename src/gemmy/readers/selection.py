"""Which reader backend a run uses: the backends (READERS), what makes each one unusable (`problem`), and the choice
(`active_reader_name`). GEMMY_READER names one. Otherwise fastatoms is used when it is usable, else ase; an installed
fastatoms that is unusable falls back with a warning that names the cause, and one that is not installed falls back
silently. The choice is made once per process. Probing imports ASE and fastatoms only inside the probes, so importing
this module needs neither."""

from __future__ import annotations

import os
import warnings
from collections.abc import Callable

from .ase_reader import AseReader
from .fastatoms_reader import FastatomsReader
from .formats import FASTATOMS_FORMATS

READER_ENV = "GEMMY_READER"
READERS = {"ase": AseReader(), "fastatoms": FastatomsReader()}
# The cause `problem` gives for a fastatoms package that is not installed at all. The choice compares with it, so a
# missing package falls back silently while any other cause is named in a warning.
NOT_INSTALLED = "fastatoms is not installed (uv sync --group fastatoms, or pip install the fastatoms package)"
# The names of the binding that the fastatoms backend uses. A binding that lacks any of them is not usable, whatever its
# import does.
FASTATOMS_NAMES = ("io.read", "FormatError", "Atoms.cell", "Atoms.labels", "Atoms.symbols", "Atoms.arrays")
# The warning's stack level: active_reader_name, then load_structure, then the caller of load_structure.
STACKLEVEL_OF_LOADER_CALLER = 3

_chosen: str | None = None


def active_reader_name() -> str:
    """The backend a load uses, chosen on first use and kept for the process. GEMMY_READER names one (stripped; empty
    means automatic). Automatic is fastatoms when it is usable, else ase with a warning that names the cause."""
    global _chosen
    if _chosen is None:
        name, fallback_cause = _choose()
        _chosen = name
        if fallback_cause is not None:
            warnings.warn(
                f"fastatoms reader unusable ({fallback_cause}); reading structures with ase",
                RuntimeWarning,
                STACKLEVEL_OF_LOADER_CALLER,
            )
    return _chosen


def reset_reader_choice() -> None:
    """Forgets the choice, so the next load chooses again (tests change the environment between loads)."""
    global _chosen
    _chosen = None


def problem(name: str) -> str | None:
    """Why the named backend cannot be used here, or None when it can."""
    return PROBLEM_OF[name]()


def _choose() -> tuple[str, str | None]:
    """The backend to use, and the cause of a fastatoms that is installed but unusable (None otherwise)."""
    requested = os.environ.get(READER_ENV, "").strip()
    if requested:
        return _requested_reader(requested), None
    fastatoms_cause = problem("fastatoms")
    if fastatoms_cause is None:
        return "fastatoms", None
    ase_cause = problem("ase")
    if ase_cause is not None:
        raise RuntimeError(f"no structure reader is usable: ase: {ase_cause}")
    return "ase", None if fastatoms_cause == NOT_INSTALLED else fastatoms_cause


def _requested_reader(requested: str) -> str:
    """The backend GEMMY_READER names, which must exist and be usable."""
    if requested not in READERS:
        raise ValueError(f"{READER_ENV}={requested!r}: use one of {', '.join(READERS)}")
    cause = problem(requested)
    if cause is not None:
        raise RuntimeError(f"{READER_ENV}={requested}: the {requested} reader is unusable: {cause}")
    return requested


def _ase_problem() -> str | None:
    """Why ASE cannot be used here, or None."""
    try:
        import ase.io  # type: ignore  # noqa: F401 -- the import is the probe
    except ImportError as exc:
        return f"ASE is required to load structure input: ase is not installed ({exc})"
    except Exception as exc:
        return f"ASE is required to load structure input: ase is broken ({type(exc).__name__}: {exc})"
    return None


def _fastatoms_problem() -> str | None:
    """Why the fastatoms binding cannot be used here, or None: it is not installed (NOT_INSTALLED), its import fails, it
    lacks a name the backend uses, or it does not read a format the backend reads. Only a missing package names itself
    as the missing module; a package that is there but fails to import is installed, and broken."""
    try:
        import fastatoms  # type: ignore
    except ModuleNotFoundError as exc:
        if exc.name == "fastatoms":
            return NOT_INSTALLED
        return f"fastatoms is broken (its import needs {exc.name}, which is missing)"
    except Exception as exc:
        return f"fastatoms is broken ({type(exc).__name__}: {exc})"
    try:
        missing = [name for name in FASTATOMS_NAMES if not _has_name(fastatoms, name)]
        formats = set(fastatoms.available_formats())
    except Exception as exc:
        return f"fastatoms is broken ({type(exc).__name__}: {exc})"
    if missing:
        return f"fastatoms lacks {', '.join(missing)}, which the backend uses"
    absent = [name for name in FASTATOMS_FORMATS if name not in formats]
    if absent:
        return f"fastatoms does not read {', '.join(absent)}"
    return None


def _has_name(module: object, dotted: str) -> bool:
    """Whether `module` has the dotted attribute path, such as `io.read` or `Atoms.cell`."""
    owner = module
    for part in dotted.split("."):
        if not hasattr(owner, part):
            return False
        owner = getattr(owner, part)
    return True


# Each backend's probe, by its name (`problem` dispatches here). Defined after the probes it names.
PROBLEM_OF: dict[str, Callable[[], str | None]] = {"ase": _ase_problem, "fastatoms": _fastatoms_problem}
