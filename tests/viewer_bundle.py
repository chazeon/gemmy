"""The viewer's pure TypeScript modules, bundled once per test session so node can run them.

`web/test/entry.ts` re-exports the modules with no DOM (camera math, scene bounds, the view math, instancing); they
may use three.js math, which is a dev dependency in web/ and bundles for node. esbuild from `web/node_modules` bundles
them into one ES module; the two placeholders the page fills in get the values `gemmy.view` writes. Callers skip when
`available()` is false (node or web/node_modules missing).
"""

from __future__ import annotations

import atexit
import functools
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from gemmy.view import _axis_fonts, render_constants

WEB = Path(__file__).resolve().parents[1] / "web"
ESBUILD = WEB / "node_modules" / ".bin" / "esbuild"


def available() -> bool:
    return shutil.which("node") is not None and ESBUILD.exists()


@functools.cache
def module_url() -> str:
    """A file:// URL of the bundled modules (one build per test process)."""
    scratch = tempfile.mkdtemp(prefix="gemmy-viewer-test-")
    atexit.register(shutil.rmtree, scratch, ignore_errors=True)
    out = Path(scratch) / "viewer-pure.mjs"
    subprocess.run(
        [
            str(ESBUILD),
            str(WEB / "test" / "entry.ts"),
            "--bundle",
            "--format=esm",
            "--platform=neutral",
            "--main-fields=module,main",
            f"--outfile={out}",
            "--log-level=warning",
        ],
        check=True,
    )
    text = out.read_text(encoding="utf-8")
    text = text.replace("__CONSTANTS_JSON__", json.dumps(render_constants()))
    text = text.replace("__AXIS_FONTS_JSON__", json.dumps(_axis_fonts()))
    out.write_text(text, encoding="utf-8")
    return out.as_uri()


def header() -> str:
    """Script text that makes every export of the bundle a global, so a test script can call them by name."""
    return f"const viewer = await import({json.dumps(module_url())});\nObject.assign(globalThis, viewer);\n"
