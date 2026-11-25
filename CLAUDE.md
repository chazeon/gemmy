# CLAUDE.md

gemmy compiles crystal structures (POSCAR + TOML or JSON config) into `scene.json` outside Blender,
then renders that scene inside Blender. Minimum Blender: 4.2 LTS (Python 3.11).

## Check command (run before every commit)

    scripts/check.sh      # ruff format --check, ruff check, pytest -q; with node also tsc and a fresh viewer build; all must pass
    scripts/check.sh --browser   # also the viewer in headless Chrome (pytest -m browser, ~20 s); --blender for the Blender suite
    scripts/check.sh --slow      # also the heavy examples and the hosted site build (pytest -m slow, about a minute)

The pre-commit hook (`scripts/hooks/pre-commit`: ruff on staged Python, Biome on staged viewer source) is enabled per
clone with `git config core.hooksPath scripts/hooks`.

## Module map (src/gemmy/)

Data shapes, defined once as plain frozen stdlib dataclasses (importable in Blender, never import pydantic):
- `scene.py`: `SceneDocument` and its parts, `check_references` (ids, face indices, duplicates), `from_dict` (generic JSON -> dataclass, used by Blender), `load_scene`. `Strict` base sets `__pydantic_config__ = {"extra": "forbid"}` so TypeAdapter rejects unknown keys.
- `settings.py`: `RenderSettings` (what the user writes; field `metadata` holds numeric bounds, attribute docstrings become `--help` text), `RenderPlan` (resolved; `RenderSettings.resolve`), `load_plan`, `check_settings`. `Quality`, `Axes`, `PolyhedronStyle`, `ArrowStyle` are shared by both.
- `geom.py`: stdlib vector/rotation/look-at/cylinder/arrow/dash/dot/bounds/shrink/screen-direction/axis-label math. The Blender backend gets numbers from here and only applies transforms.
- `datafile.py`: `read_data`, TOML (`.toml`, stdlib tomllib) or JSON for every user-written file (config, settings, labels, displacements).

Outer process (may use numpy/scipy/ASE/pydantic):
- `config.py`: compile config (pydantic models, aliases, RGB coercion) and validation: `validate_scene`, `validate_settings` (TypeAdapter + the plain checks), `save_scene`, `scene_to_dict`.
- `structure.py`: `Structure`, `AtomRecord`, POSCAR loader (keeps species labels as `style_key`).
- `cli.py` (`compile`, `render`, `_run-plan` inside Blender), `cli_args.py` (tyro builds the flags from the settings dataclasses; lazily imported, tyro is not available inside Blender).
- `compile/`: the stages that decide which atoms are shown (README, "Which atoms are shown") as plain functions, fixed order written out in `pipeline.py`.
  `lattice` (numpy: offsets, snap/wrap, box shifts, limits, convex hull) · `sites` (Site, snap/wrap, display box, limits, name matching, `point_key`) · `bonds` (neighbours, rules, detection, completion) · `polyhedra` · `selection` (labels/indices/shell_of; separate from `sites` because it needs `polyhedra`) · `labels` (sources + applying) · `displacements` · `materials` (element style, material variants, visibility) · `pipeline` (`SceneAssembler`, `PointTable`, `compile_structure`, `compile_scene`, `compile_to_json`).

Render side (stdlib + bpy only; bpy imported lazily inside Blender code):
- `render/`: `runner` (`render_plan`, `build_scene_with_backend`, the backend Protocols `Geometry`/`Stage`) · `looks` (look presets, named views, framing) · `materials` (scene material -> `ShaderSpec`) · `launch` (find and spawn Blender).
- `view.py` (`gemmy view`, stdlib only): writes the viewer page from `viewer/` (built files, see `web/` below); `serve.py` is the live preview.
- `web/` (dev only, not in the wheel): the viewer. Plain TypeScript under `web/src` draws the canvas; the overlay is React in `web/src/react`, with shadcn/ui components in `web/src/components/ui` on Tailwind v4 (`tailwind.css`). `page.html` and `style.css` are the page's own. `npm --prefix web run build` writes the built `viewer.js`, `page.html` and `style.css` into `src/gemmy/viewer/`; never edit those built files. `npm --prefix web run check` is tsc. `web/test/entry.ts` is the pure part the node tests bundle (`tests/viewer_bundle.py`). `web/README.md` has the structure.
- `render/blender/`: one mixin per concern: `atoms` (linked duplicates + Geometry Nodes instancing), `primitives`, `materials`, `world` (lights, backdrop, camera), `renderer` (device and engine choice, output), `overlay` (axes triad).
- `scripts/blender_build_scene.py`: sys.path shim only.

Import rules are enforced by `tests/test_import_boundaries.py` (a table of rules; edit it when modules move):

| Files | Must not import |
|---|---|
| `geom.py`, `scene.py`, `settings.py`, `datafile.py`, `render/**` | ase, numpy, scipy, pydantic, tyro (any scope); compile, structure, config at module level |
| `config.py` | ase, numpy, scipy at module level |
| `cli.py`, `__init__.py` | heavy packages, tyro or compile modules at module level (import lazily inside functions) |
| `cli_args.py` | numeric stack, pydantic or compile modules at module level (tyro is fine) |

## Contracts

- Scene: `scene.py` (`SCENE_SCHEMA_VERSION`). Settings and plan: `settings.py`. One definition each; there are no mirrors.
- Scene layout: `materials` (id -> definition), `points` (one buffer, geometry refers to point ids), `topologies`
  (face index buffers into `points`), `primitives` (atoms, bonds, polyhedra, displacements; point and material ids
  only, never copied geometry or material structs). A point may carry `ref`, the atom reference users type in configs
  (`"5"` or `"5+1_0_0"`, relative to the wrapped in-cell atom; `selection.parse_site_ref`).
- Backend Protocols: `render/runner.py`. Config format: `config.py` and `configs/default.json`.
- Unknown config, settings or scene keys are errors (pydantic `extra="forbid"`); the error path names the key.
- Validation happens in the outer process only; Blender reads already-validated JSON with `from_dict`.
- Contract changes go in their own commit, never mixed with feature work. Update golden files
  deliberately in that commit only.

## Tests and golden files

- Fixtures in `tests/fixtures/` are synthetic, one directory per case. `tests/test_golden.py` compares
  normalized compiled scene.json with each `scene.golden.json`.
- Regenerate only deliberately: `GEMMY_UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py`;
  explain every golden diff in the commit message.

## Rules

- Add features by adding files or table entries, not by growing central if/elif chains.
- Group by concept: one file per concept, split a file only when it passes ~400 lines. No stub or identity files; no re-exports, shims or compatibility code (move a name, update every call site, delete the old path).
- Do not edit outside your task's files. No drive-by refactors.
- Tests stay green at every commit. Ruff must pass; use `# noqa` or per-file ignores only
  with a comment saying why.
- Never commit research data (real POSCARs, displacement files, renders). Use synthetic fixtures.
  The owner's private data lives in `examples/private/` (gitignored); read it, never `git add -f` it.
  Committed examples (`examples/<name>/`) are public structures: POSCAR, `config.toml` + `config.json` (kept equal by
  a test), README, `render.sh` and `gallery.json` (title and description; the hosted front page's start screen lists
  them, `gemmy view --hosted --gallery examples`, scripts/build_site.sh); no scene.json. Their small README pictures live in `docs/images/`, made by
  `scripts/render_examples.sh`. `tests/test_examples.py` compiles them, so keep configs current when keys change.
- Do not push or merge unless asked.

## Workflow

- Work in a git worktree on its own branch.
- A new worktree: run `scripts/worktree-setup.sh` once. It runs `uv sync` (a .venv per worktree, because the
  editable install points at its own src) and links `web/node_modules` to the main checkout's when the two
  `web/package-lock.json` files match, else runs `npm ci`. Measured: warm setup 0.5 s; cold caches, uv sync 2.7 s and
  npm ci 2.9 s. Never run `npm install` or `npm ci` inside a linked worktree: it changes the main checkout's modules too.
- One concern per commit; message `<step>: <goal>` plus a short body.
- End every commit message with:

      Claude-Session: <session url>
