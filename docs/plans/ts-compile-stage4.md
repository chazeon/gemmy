# Stage 4 design: the viewer opens a structure

The design for stage 4 of `ts-compile.md`. A `Source` describes where a tab's input comes from and never changes; what
changes lives on the tab (`loader.ts`). The viewer bundle never imports fastatoms or `compile/`. It takes
`structure/readers.ts` (name matching, which has no wasm) and `import type`s only.

## Source and the dropped files

- `scene/source.ts`: `{ kind: "structure"; file: File; sidecars: readonly File[]; types?: TypeMap }`.
  - `nameOf` gives the file's name, and `fromOf` gives "local structure, compiled in the page".
  - `queryOf` is null, so there is no link. It is closable, like `file`.
  - A type-map retry replaces the tab's source with `{...source, types}`.
- New `scene/drop.ts` (pure, so a node test covers it): `groupFiles(files): Source[]`, called by `openFiles`.
  - A drop with no structure file gives scene tabs, as today.
  - Each structure file (`readerFor(name)`) gives one structure tab. Every other dropped file is a sidecar of each of
    them.
- Picking the config (`compile/files.ts`, a `FileSource` over the sidecars):
  1. `config.*`, or `<structure stem>.*`;
  2. else the only `.toml` or `.json`;
  3. else an error that names the candidates.
- With no config, `defaultConfig(structure)` is used: `configs/default.json`, with `structure` filled in. Stage 6 adds
  derived rules behind the same signature.
- A `labels.file` or `displacements.file` that was not dropped is an error that lists the dropped files.
- `#scene-file` gets `multiple`. Its `accept` is set in `attachOpeners` from whether a compiler is available.

## Loading the compiler (no dynamic import)

- A second bundle, `compile.js`, built from `src/compiler/entry.ts`. It sits outside `structure/` and `compile/`.
  - It imports `structure/fastatoms.ts` and `compile/` statically and sets
    `globalThis.__gemmyCompiler = { ready: initStructureReader(), readStructure, neighborSource, parseSceneConfig,
    defaultConfig, compileStructure, ... }`.
  - It bundles `configs/default.json` (json loader).
  - It has no React and no three. Measure its size; switch to `zod/mini` if zod is large.
- `scene/compiler.ts` (viewer side):
  - `compilerHref()` reads `<meta name="gemmy-compiler">`. `compilerAvailable` is synchronous.
  - `loadCompiler()` injects `<script type="module" src=href>` on the first structure open and awaits `ready`. The
    promise is cached and cleared on failure.
  - The `Compiler` type comes from `import type` of the entry's modules.
- `build.mjs`: a list of entries, one loop. `compile.js` has no externals and is never inlined.
- `view.py`:
  - a `__COMPILER__` placeholder in page.html, filled with the meta or with nothing;
  - `render_page`, `render_live_page` and `render_loader_page` take `compiler=None`;
  - `render_viewer` (single file) never passes it.
- `site.py`: `_SharedFiles.compiler` (`compile.<hash>.js`). It is written by `write_hosted_site`, and its href is
  passed to scene and front pages with the same prefix as the assets.
- `serve.py`: `/compile.js` route, and `render_live_page(..., compiler="compile.js")`.
- Single-file page:
  - no meta, so the card text stays scene-only;
  - a dropped structure fails on the card with "This page is one self-contained file and cannot compile structures.
    Run gemmy compile, or open the hosted viewer or gemmy serve."
- Hosted and serve card: "Open a scene or structure", "A POSCAR, CIF, extxyz or LAMMPS file, with an optional config.
  Or a scene.json."

## Tab state (ready for stage 6)

- `ui/structure-model.ts`:
  - `StructureModel = { name, fileName, structure, neighbors, files, config: Signal<SceneConfig>, types, compiler }`;
  - `compileModel(model)`;
  - `activeModel = signal<StructureModel | null>`, set by `showCurrent`.
- `loader.ts`: `Loaded = { doc, name, model? }`. `case "structure"` → `loadStructureTab`, which does, in order:
  1. load the compiler;
  2. read the text (gunzip as `read.ts` does);
  3. `readStructure`;
  4. if types are unresolved, throw `TypesNeeded`;
  5. pick the config and parse it;
  6. make `neighborSource`;
  7. `compileStructure`.

  The tab caches its model.
- Stage 6 adds one effect per model: the config changes, `compileModel` runs, then `updateScene` (which keeps the
  camera). It runs only on the shown tab.

## Errors

- Load errors go to the card (`fail`, plain text, multi-line).
  - A `ConfigError` gives one line per issue, with the key path, prefixed by the file name.
  - A config that names a labeler says the labeler hook doesn't run in the browser and to use `labels.file`.
  - A reader error gives `<file>: <message>`.
  - A scene.json dropped as a sidecar says to open it on its own.
- Before the prompt, a saved preset whose type signature matches is applied (ts-compile.md §4, Presets): a toast
  with Undo, no form.
- `TypesNeeded` brings up the card's `TypeMapForm` (`CardState.typePrompt`).
  - It has a row per type, with Apply and Cancel.
  - The inputs keep their own React state.
  - Testids: `type-map` and `type-input-<n>`.
- A failed recompile on a tab that is already shown (stage 6) goes to the toast (`note(msg, STAY)`) and keeps the
  previous scene. `reportCompileError` formats the message for both paths.

## Browser tests

- `test_browser.py`:
  - the hosted site has `compile.*.js`;
  - `view-stishovite.html` has no `gemmy-compiler` meta and no `import(`.
- `driver.mjs` steps on the site front page:
  - `drop-poscar`: the stishovite POSCAR alone; draw counts > 0 and no alert;
  - `drop-poscar-config`: POSCAR plus `config.toml`; the counts equal the example's;
  - a LAMMPS file with no type information: the form appears, fill it in, and the scene shows;
  - on the single-file view page, a dropped POSCAR gives the "cannot compile structures" alert.
- The goldens are regenerated deliberately and explained in the commit message.

## Docs that change

- `web/README.md`:
  - two bundles;
  - "The single file" (the compiler is a separate script, injected only on pages with the meta);
  - the structure source and `groupFiles`;
  - the new files.
- `CLAUDE.md`:
  - the build writes four files;
  - the `view.py` and `site.py` lines.
- `ts-compile.md` §8.1: resolved as above.

## Risks

- The compile runs on the main thread. Large examples freeze the page, so show `busy("Compiling…")`. A worker built
  from the bundle's text is a later option.
- Module scripts fail on `file://` copies of a hosted page. `loadCompiler`'s error says so.
- The config pick is the soft spot when several configs are dropped. `config.*` or the stem name always wins.

## Status

Implemented (stage 4b):

- [x] `compiler/entry.ts` registers the compiler: readStructure, neighborSource, the config functions, defaultConfig,
  compileScene, the file source, pickConfig and sidecarKind. `compile.js` is about 0.95 MB raw, 0.35 MB gzipped; fastatoms
  is most of it (0.84 MB). zod is about 28 KB minified, so it stays (no `zod/mini` switch).
- [x] The structure source, `sourcesOf` (drop.ts), `multiple` on the file input, and its accept set from `compilerAvailable()`.
- [x] `ui/structure-model.ts` (`StructureModel`, `activeModel`, `TypesNeeded`) and `loadStructure` in `ui/loader.ts`.
- [x] pickConfig skips label, displacement and scene files (content), and the files a config names.
- [x] Errors on the card, as plain text; the single-file page's alert for a structure.
- [x] The type form (`react/type-map-form.tsx`, testids `type-map`, `type-input-<n>`) and the presets
  (`ui/type-presets.ts`): save on apply, automatic match with an Undo toast, choose, rename, delete, export, import.
- [x] Browser scenarios (`drops`, `alert`) and their goldens; the single-file page's test asserts on the meta and the
  `compile.js` reference.

Not in stage 4: recompiling on a config change and the style panel (stage 6), the `types` config key (stage 5), and the
`structure` key of a config matched against the dropped files.

Deviations from the design above:

- The loader calls `compileScene` (not `compileStructure`): `compileScene` loads the labels and displacement files the
  config names, from the dropped sidecars, then calls `compileStructure`.
- `StructureModel` has `fileName` (the file's name) and no separate `name`.
- `ReadStructureResult` gained `typeSignature` (computed from the per-atom type, masses and labels arrays), the minimal
  change the design allowed.
- The presets are one list in localStorage under `gemmy.typePresets`. A structure's file accept is empty on a page that
  compiles (a POSCAR has no extension to filter by).
- Sidecar names are looked up as a config writes them: normalised against the config's folder (the root, for dropped
  files), then by base name. Two dropped files that match one name are an error that names both.
- The compiler's address must be on the page's own site (`compilerUrl`, scene/compiler.ts); a file: page is refused.
