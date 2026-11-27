# PLAN: compile in the browser (TypeScript)

Goal: the viewer reads a structure file (VASP POSCAR/CONTCAR, extxyz, CIF, LAMMPS data and dump) plus a gemmy
config and compiles the scene itself, with no Python. The result must equal what `gemmy compile` writes for the same
input. Python stays the reference: the TS port is checked against it on every fixture and example.

Branch `ts-compile`, worktree `.claude/worktrees/ts-compile`. It merges into `main` in stages (§6). Each stage is green
on `scripts/check.sh` (plus `--browser` from stage 3 on).

## 1. What gets ported

The Python compile path is ~1.2k lines: `structure.py` (load), `config.py` (the compile config only), and
`compile/` (`lattice`, `sites`, `bonds`, `polyhedra`, `selection`, `labels`, `displacements`, `materials`,
`pipeline`). Its numeric dependencies map like this:

| Python | TS |
| --- | --- |
| `ase.io.read` + the POSCAR label patch (`structure.py`) | fastatoms (wasm), which keeps the labels itself (`Fe1`, `Fe_pv`, `Fe/hash`) |
| `Atoms.repeat`, `get_scaled_positions(wrap=False)` | fastatoms `Atoms.repeat` and `getScaledPositions` (ASE order) |
| `ase.neighborlist.neighbor_list("ijSd")` | fastatoms `neighborList("ijSd")` (vesin, ASE semantics) |
| `scipy.spatial.ConvexHull` | `quickhull3d` (npm, MIT, no dependencies), behind one function |
| pydantic config models | `zod` schemas with `.strict()` (unknown keys are errors, and the error path names the key) |
| `tomllib` (`datafile.py`) | `smol-toml` |
| numpy array math | plain loops on `Vec3` tuples. They are 3-vectors; no matrix library. |

Not ported: `labels.labeler`, the Python hook. It cannot run in a browser. A config that names one gets an error that
says so and points at `labels.file`.

## 2. Layout (all under `web/`)

Group by concept, one file per Python module, so a reader can diff a stage against its Python twin:

```
web/src/structure/            reading files into a Structure (no DOM, no three)
  structure.ts                Structure, AtomRecord (the same shape as structure.py)
  readers.ts                  the format table: { name, matches(fileName, text), read(text, options) } per format
  fastatoms.ts                the only module that imports fastatoms: init, read, the Atoms -> Structure step
  types.ts                    the type-map interface (§4)
web/src/compile/              the stages (no DOM, no three, no React)
  config.ts                   the zod schemas, defaults, RGB -> RGBA, DEFAULT_MATERIALS
  lattice.ts  sites.ts  bonds.ts  polyhedra.ts  selection.ts  labels.ts  displacements.ts  materials.ts
  hull.ts                     convexHullFaces (quickhull3d plus the outward winding of lattice.convex_hull_faces)
  pipeline.ts                 SceneAssembler, PointTable, compileStructure, compileScene
  files.ts                    FileSource: name -> text, for the files a config names (fs in node, dropped files in the page)
web/vendor/fastatoms/         the built fastatoms package (§3), committed like src/gemmy/viewer
web/test/compile-entry.ts     what the node parity tests bundle
```

Boundaries, enforced by a test (`tests/test_ts_boundaries.py`, which scans the import lines):
- `structure/` and `compile/` import neither three, React nor the DOM (`document`, `window`).
- Only `structure/fastatoms.ts` imports `web/vendor/fastatoms`.
- `compile/` does not import `structure/fastatoms.ts`. The pipeline takes a `Structure` and a `NeighborSource`
  (`repeat` + `neighborList`), so the stages can be tested without the wasm.

## 3. fastatoms

- Source: `chazeon/fastatoms`, branch `wasm-core`, pinned to a commit (now `b0ee50e`).
- Build: `scripts/build_fastatoms.sh <sha>`. It clones the commit to a scratch directory and runs
  `js/scripts/build-wasm.sh --gemmy -DFASTATOMS_WITH_LAMMPS=ON -DFASTATOMS_WASM_SINGLE_FILE=ON` (emsdk at
  `~/emsdk`). It builds the TS wrapper and copies `dist/` into `web/vendor/fastatoms/` with a `SOURCE` file that
  names the repo, the commit, the preset and the sizes. The `--gemmy` preset has no spglib.
- The wasm lives inside the `.mjs` (`SINGLE_FILE`), so esbuild bundles it with no loader setup and no fetch of a
  `.wasm` by URL. That costs about 1.33× in raw size. The gzipped size is close to the separate file's.
- Vendored, not an npm git dependency: building needs emsdk, and `npm ci` must work without it. Biome and tsc
  skip `web/vendor/`.
- A fastatoms bug we hit gets fixed upstream on `wasm-core`, then the pin moves. No patches to the vendored copy.

## 4. Type mapping (LAMMPS, and labels in general)

LAMMPS files carry type numbers, not elements. fastatoms resolves a type in this order: an explicit `types` option,
the `Atom Type Labels` section, a `Masses` comment that agrees with the mass, the nearest mass. A dump with no element
column and no map gives the dummy element `X` with label `"k"`.

The TS interface:

```ts
// types.ts
type TypeMap = Readonly<Record<number, string>>;   // LAMMPS type -> label ("Fe1"); the element comes from the label
// fastatoms.ts (the only module that imports fastatoms)
interface ReadStructureOptions { fileName: string; format?: string; configTypes?: TypeMap; pageTypes?: TypeMap }
interface ReadStructureResult { structure: Structure; unresolvedTypes: number[] }  // types that fell back to X
function readStructure(text: string, options: ReadStructureOptions): ReadStructureResult;
// readers.ts: one row per format; the row whose matches(fileName) is true reads the file
```

- `readStructure(text, options)` passes a map through to fastatoms for the LAMMPS rows only, in one of two modes.
  `pageTypes` (the form and the presets) is lenient: it may name only some types, and it reports the types that stayed
  unresolved (an atom whose label is its type number), so the page can ask for them (a small form: type → label) and
  read again. `configTypes` (a config's `types` key) is strict, as Python's load_structure is: it throws Python's error
  text for a file that is not LAMMPS, a file with no type column, or a type it leaves unnamed. When both are given the
  config's wins. The page does not guess.
- The label becomes `style_key`, as a POSCAR species label does. So `Fe1` and `Fe2` can both be iron with two styles.
- **Presets (owner, 2026-11-25).** Someone with several LAMMPS files from one project should map the types once.
  - A type map the user enters is saved as a named preset in the browser (`ui/storage.ts`, localStorage). Each
    preset stores its map plus the file's type signature: the number of types and, when the file has them, the masses
    and Atom Type Labels.
  - When a file's signature matches a saved preset, the page applies the preset with no prompt and says so in a
    toast with Undo.
  - When several presets match, the form opens with them listed.
  - The form lists every preset (choose, rename, delete) and can export or import presets as a small JSON file, so a
    group can share them.
  - The same map also travels in the exported config (the `types` key below), so `gemmy compile` reads it too. A
    config that carries `types` wins over a preset.
- Config side, decided later (stage 4): a `types` key in the compile config (`[types] 1 = "Fe"`). It is a contract
  change, so it goes in its own commit on both sides. Python's LAMMPS path (`ase.io.read`) would then need the same
  map. Until then the map comes only from the page.
  Python refuses a map that leaves a type of the file unnamed (the error names the types and the key); the page reads the same file, lists those types in `unresolvedTypes` and asks for them.

## 5. Parity with Python: the test that defines "done"

- `tests/test_ts_compile.py` bundles `web/test/compile-entry.ts` with esbuild (as `tests/viewer_bundle.py` does) and
  runs it in node. For every `tests/fixtures/<case>/` and every committed `examples/<name>/`, it compiles with TS and
  with Python, then compares the two scene dicts after `golden.normalize`.
- Everything is compared exactly (ids, order, materials, refs), except:
  - **Floats**: after `normalize` (6 decimals). This is already the golden rule.
  - **Hull faces**: Qhull and quickhull split a non-triangular facet (a square, say) differently. Faces are compared
    as facets: triangles grouped by plane, each facet as its set of corner point ids. Winding is checked separately
    (every normal points away from the centroid).
- Order: Python sorts each atom's neighbours by (index, shift) and the stages iterate in list order, so TS matches
  element for element once it does the same. A difference in order is a bug, not noise.
- Unit parity per stage as well (`tests/test_ts_stages.py`): the reader against `load_structure` (elements, labels,
  fractional coordinates, lattice), and the neighbour graph against ASE on the fixtures and on random triclinic cells.
  These narrow a failure before the full scene comparison.
- Heavy examples (`nucleosome-1kx5`, `apoferritin`, ...) run under `-m slow`.

## 6. Stages and merges

Each stage ends with a Sonnet audit, the fixes, `scripts/check.sh`, and a merge to `main` (`merge ts-compile: <stage>`).
The milestones marked **Codex** also get a Codex audit before the merge.

| Stage | Work | Merge when |
| --- | --- | --- |
| **0** | This plan. | Plan committed (on the branch; it merges with stage 1). |
| **1 Reading** | `scripts/build_fastatoms.sh`, `web/vendor/fastatoms/`, `structure/` (readers table, Atoms → Structure, type map), `test_ts_stages.py` reader parity, `test_ts_boundaries.py`. | Every fixture and example reads like `load_structure`; LAMMPS data and dump fixtures read with and without a type map. **Codex** |
| **2 Stages** | `compile/config.ts`, `hull.ts`, `lattice`, `sites`, `bonds`, `polyhedra`, `selection`, `labels`, `displacements`, `materials`, each with stage parity tests. | Each stage's parity test passes. |
| **3 Pipeline** | `pipeline.ts`, `files.ts`, `test_ts_compile.py` on every fixture and example. | Full scene parity everywhere. **Codex** |
| **4 Viewer** | The Open card takes a scene or a structure (+ config, else the defaults, §7), the type-map prompt, an error toast with the key path, the bundle strategy (§7), the browser test, `web/README.md`. | `check.sh --browser` passes. **Codex** |
| **5 Contract** (optional) | The `types` config key, Python and TS, in its own commit. | Golden diffs explained. |
| **6 Style panel** | §7: the config signal, live recompile, default rules, Export config / Export scene, the controlled panel (shadcn/ui). Sub-stages, each merged: config state + export, then elements, then bonds, then polyhedra and cell. | Browser test per sub-stage; the exported config compiles in Python to the scene the page shows. **Codex** at the end |

How the work is split: Haiku agents write the code, one file group each with an explicit brief (the Python module to
mirror, the test to pass). A Sonnet agent audits each stage's diff against the Python twin and this plan. Codex audits
the milestones. I write the briefs, run the checks, review and merge. Nothing is pushed unless asked.

## 7. The page: open a scene or a structure, then style it

Where this is going (owner, 2026-11-25): the Open card takes **either a scene file or a structure file**. The config is
a good default that the page holds and can export. On top of it, a VESTA-style panel changes the look in a controlled
way.

- **One state, one compile.** The page's config is a signal (`SceneConfig`, validated by the same zod schema). A
  structure tab keeps its `Structure` and `NeighborSource`. A change to the config recompiles (`compileStructure`)
  and rebuilds the stage, keeping the camera. A scene tab, from a scene file, has no structure: it is view only, and the
  style panel is off for it.
- **Defaults.** A structure opened alone gets `configs/default.json` (elements, colours, radii) plus default bond and
  polyhedron rules derived from it. A config dropped with the structure replaces the defaults. A config's `structure`
  key is matched by name against the dropped files.
- **Export.** Export config (TOML or JSON, the file `gemmy compile` reads, with the structure name filled in) and
  Export scene (`scene.json`, which the Python side validates). Round trip: an exported config compiled by Python
  gives the same scene as the page shows. The parity test (§5) is what guarantees this.
- **Controlled editing.** The panel edits config fields only. It never edits the scene directly. Each control is bound
  to one schema field and takes its bounds from the schema, so the panel cannot produce a config that Python would
  reject:
  - per element or label: visible, colour, radius;
  - per bond rule: on or off, min and max length (a slider over the distances that actually occur for that pair, from
    the neighbour list), radius, colour, style;
  - per polyhedron rule: on or off, ligands, distance window, colour;
  - cell: supercell, box, periodic.
  Adding a rule (a pair or a centre) chooses from the labels present in the structure, not free text.
- **Speed.** A recompile must feel live on the examples (target < 50 ms for ~1k atoms). The neighbour list is cached
  per (supercell, periodic, cutoff), and a change that only touches colours or radii skips the geometry stages if
  profiling shows it is needed. Measure first.

## 8. Open questions

1. ~~**Where the compiler ships.**~~ Resolved in `ts-compile-stage4.md` (`compile.js`, injected by a meta). The fastatoms module is roughly 0.7 MB raw (about 0.29 MB gzipped). Proposal: a
   second bundle, `compile.js`. The hosted site and `gemmy serve` load it (hashed, as `viewer.<hash>.js` is) the first
   time someone opens a structure file. The single-file `gemmy view` page leaves it out: its scene is already compiled,
   and the page must stay one script with no dynamic `import()`. The alternative is to always inline it, which makes
   every offline page about 0.7 MB larger.
2. ~~**The fastatoms loader.**~~ Solved upstream (`b0ee50e`): `init(glue)` takes the statically imported glue, so the
   reader bundles like any module.
