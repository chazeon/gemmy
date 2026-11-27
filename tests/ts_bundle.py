"""The compile-side TypeScript (web/src/structure, and web/src/compile once it exists) run in node for the parity tests.

`web/test/compile-entry.ts` is bundled with esbuild's JS API. The vendored fastatoms is bundled in too: its glue is
handed to `init()` by the structure reader, so no dynamic import of the wasm file runs.

`run(jobs)` sends a list of jobs to one node process and returns one result per job, in order. A job is
`{"fn": <export name>, "args": [...]}`: the named export of the bundle is called with the arguments, and its value is
returned as JSON. A job that throws returns `{"error": message, "type": error class name}` and does not stop the batch.
A value may hold null (a Python None, such as `ref: null`). The runner rejects what JSON would silently change: an
undefined value, a non-finite number and a typed array. It reports each such job as an error that names the path.
Callers skip when `available()` is false (node or web/node_modules missing).
"""

from __future__ import annotations

import atexit
import functools
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from gemmy.view import _axis_fonts, render_constants

WEB = Path(__file__).resolve().parents[1] / "web"
ESBUILD_PACKAGE = WEB / "node_modules" / "esbuild" / "package.json"
TIMEOUT_SECONDS = 60

# Bundles the entry (the vendored fastatoms included).
BUNDLER = r"""
import { createRequire } from "node:module";
const [web, entry, out, registry] = process.argv.slice(2);
const { build } = createRequire(web + "/package.json")("esbuild");
// A registry given (a test's own list of colour schemes) stands in for the shipped one wherever the page imports it.
const useRegistry = {
  name: "registry-override",
  setup(build) {
    build.onResolve({ filter: /\/schemes\/registry$/ }, () => ({ path: registry }));
  },
};
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  plugins: registry ? [useRegistry] : [],
  // The browser build of each package (debug, through quickhull3d, has a node build that requires "tty"), as the page
  // bundles it. The node: builtins stay external; the fastatoms glue detects its environment when it runs in node.
  platform: "browser",
  external: ["node:*"],
  outfile: out,
  logLevel: "warning",
});
"""

# Reads the jobs from stdin, calls each named export and prints the results, one JSON array.
RUNNER = r"""
const lib = await import(process.argv[2]);
await lib.initStructureReader();
let input = "";
for await (const chunk of process.stdin) input += chunk;

// JSON writes undefined as nothing and NaN or Infinity as null, so a value that would change on the way is an error,
// named by its path. A null is a real null and passes.
function checkJson(value, path) {
  if (value === undefined) throw new Error(`undefined at ${path}`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`non-finite number ${value} at ${path}`);
  if (ArrayBuffer.isView(value)) throw new Error(`typed array at ${path}; return a plain array`);
  if (Array.isArray(value)) value.forEach((item, k) => checkJson(item, `${path}[${k}]`));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) checkJson(item, `${path}.${key}`);
  }
  return value;
}

// A job may be async (the page's gunzip is), so each one is awaited in turn.
const results = [];
for (const [index, job] of JSON.parse(input).entries()) {
  try {
    const value = await lib[job.fn](...job.args);
    results.push({ ok: checkJson(value, `job ${index} (${job.fn})`) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ error: message, type: error?.constructor?.name ?? "unknown" });
  }
}
process.stdout.write(JSON.stringify(results));
"""


def available() -> bool:
    return shutil.which("node") is not None and ESBUILD_PACKAGE.exists()


@functools.cache
def _bundle(registry: str = "") -> Path:
    """The bundled entry and the runner, written once per test process and registry; returns the runner's path."""
    scratch = Path(tempfile.mkdtemp(prefix="gemmy-ts-test-"))
    atexit.register(shutil.rmtree, scratch, ignore_errors=True)
    bundler = scratch / "bundle.mjs"
    bundler.write_text(BUNDLER, encoding="utf-8")
    entry = WEB / "test" / "compile-entry.ts"
    bundled = scratch / "compile.mjs"
    args = ["node", str(bundler), str(WEB), str(entry), str(bundled), registry]
    subprocess.run(args, check=True, timeout=TIMEOUT_SECONDS)
    # The viewer's build-time constants (web/src/config.ts, the axis fonts), filled in as the viewer bundle fills them.
    text = bundled.read_text(encoding="utf-8").replace("__CONSTANTS_JSON__", json.dumps(render_constants()))
    bundled.write_text(text.replace("__AXIS_FONTS_JSON__", json.dumps(_axis_fonts())), encoding="utf-8")
    runner = scratch / "run.mjs"
    runner.write_text(RUNNER, encoding="utf-8")
    return runner


def run(jobs: list[dict[str, Any]], registry: Path | None = None) -> list[dict[str, Any]]:
    """Run the jobs in one node process; one result per job, {"ok": value} or {"error": message, "type": name}.
    `registry` is a colour scheme registry module that stands in for the shipped one (schemes/registry.ts)."""
    runner = _bundle(str(registry) if registry is not None else "")
    bundled = runner.parent / "compile.mjs"
    result = subprocess.run(
        ["node", str(runner), bundled.as_uri()],
        input=json.dumps(jobs),
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
        # Node 22+ warns when debug's browser build reads localStorage; the warning is not a failure of the run.
        env={**os.environ, "NODE_NO_WARNINGS": "1"},
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == "", f"node wrote to stderr: {result.stderr}"
    results = json.loads(result.stdout)
    assert isinstance(results, list) and len(results) == len(jobs), f"runner returned {result.stdout[:200]!r}"
    for index, item in enumerate(results):
        assert isinstance(item, dict), f"job {index}: result is not an object: {item!r}"
        if "error" in item:
            assert set(item) == {"error", "type"} and isinstance(item["error"], str), f"job {index}: {item!r}"
        else:
            assert set(item) == {"ok"}, f"job {index}: result has neither ok nor error: {item!r}"
    return results
