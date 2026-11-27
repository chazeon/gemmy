# The viewer (web/)

The page that `gemmy view` and `gemmy serve` write is built from here. It has three parts: the scene on a three.js canvas,
drawn by plain TypeScript (`src/`); the floating controls over the canvas, drawn by React with shadcn/ui components on
Tailwind v4 (`src/react/`, `src/components/ui/`, `tailwind.css`); and the page template and the page's own stylesheet
(`page.html`, `style.css`). `npm --prefix web run build` writes the built files to `src/gemmy/viewer/`, which is what ships
in the wheel; never edit those. Dev only, not in the wheel.

    npm --prefix web ci         # once
    npm --prefix web run build  # after a change here: commit the built files too
    npm --prefix web run check  # tsc
    npm --prefix web run lint   # Biome (biome.json): lint and format check; no writes
    npm --prefix web run format # Biome: writes the formatting

Biome's `noNonNullAssertion` is off: the viewer reads ids and points out of a scene that `gemmy` has already
checked (`check_references`), so a Map lookup for one is known to hit, and a guard for each would hide a broken scene.
Biome's import sorting (`organizeImports`) is off: the imports stay in the order the code is written.

## Who draws what

- **React** (`src/react/`) draws every control over the canvas: the top bar (the file island: the page's name or a dropdown of the open files, and the view toolbar), Export and the theme button, the lens and zoom row, the dock (its sections: View, and Atoms,
  Bonds, Shapes and Cell for a structure) with its edge tab, the details card, the
  corner buttons, the keyboard help and the start screen. `overlay.tsx` mounts them into `#overlay` in page.html
  (`display: contents`, so each island is a grid item of `#ui`).
- **Plain TypeScript** does the rest and never imports React: the scene's loading and framing (`scene/`), the camera and its
  moves (`camera/`), the renderer, the frame loop and the triad (`render/`), the vector exports (`export/`, `trace/`), the
  pure geometry (`geom/`) and the numbers the Blender render shares (`config.ts`). The `ui/` modules hold the viewer's state,
  and the parts of the page that no component draws: the picking and the selection highlight, the stage's keys and pointer,
  the tabs' loading, the start screen's state, the message line's state, the live page and the theme on `<html>`.

## Signals bridge the two

The state is `@preact/signals-core` signals: `state.ts` (the loaded scene, the show flags, the camera) and the `ui/` modules
(`inspector` in `panels.ts`, the `readout`, the theme, the start screen's `card`, the file island's `tabBar`). A signal is the
source of truth. A component reads one with `useSignal(signal)` (`src/react/use-signal.ts`), a subscription through
`useSyncExternalStore`, not a second store. A component acts by calling a plain function (`toggleInfo()`, `cycleTheme()`),
which changes the signal.

Where a DOM step has to wait until React has drawn a change, the module sets a request signal and the component takes it
once drawn: `inspectorFocus` (`ui/panels.ts`, the focus after the dock opens or shuts) and the address box's focus
(`ui/home.ts`). Plain TypeScript does not look up a React element by id.

## Components (shadcn/ui)

- `src/components/ui/` holds the shadcn/ui components the overlay uses, as shadcn ships them (registry style new-york-v4,
  MIT). Each keeps its header and imports its helpers from `@/` (tsconfig `paths`). `src/lib/utils.ts` is `cn()`.
- To add one, copy its source from the registry (`https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`, the `content`
  of its `files`) into `src/components/ui/<name>.tsx`, keep the header, point its imports at `@/`, and run
  `npm --prefix web run check` and the build. A change to a copy is a change to this repo's copy, not to shadcn.
- The colours are the viewer's own. `tailwind.css` maps shadcn's colour names (`--color-primary`, `--color-border`, ...)
  onto the tokens in `style.css` (`--accent`, `--rule`, ...), so a component takes the light and dark colours with no second
  palette. The `dark` class on `<html>`, set by `ui/theme.ts`, selects shadcn's dark variant.

## Styles and the build

- `tailwind.css` is Tailwind v4: the preflight (the base reset, in the lowest layer), the theme and the utilities. `style.css`, in the
  `legacy` layer, beats the preflight and loses to the utilities.
- `style.css` is the page's own stylesheet, in the `legacy` layer: the tokens for both themes, the island grid, the start
  screen's cards, the fade of a scrolling row and the phone rules. Its phone width must match `PHONE_MAX_WIDTH` in
  `ui/panels.ts`.
- `build.mjs` bundles `src/main.ts` with React into `viewer.js` (minified, `process.env.NODE_ENV` set to production, three.js
  external) and `src/compiler/entry.ts` into `compile.js` (the structure compiler, no externals, its own script). It compiles
  `tailwind.css` with the Tailwind CLI, and writes the stylesheet as the Tailwind layers followed by `style.css` in
  `legacy`. It copies `page.html` with a generated-file comment.

## The single file

`gemmy view` writes one HTML file that opens from disk. `src/gemmy/view.py` puts the built `style.css` and `viewer.js` into
page.html's `/*__STYLE__*/` and `//__SCRIPT__` markers. So the bundle is one script and the stylesheet is one file: no code
splitting, no imports that esbuild would write out beside it (stylesheets, images, fonts), and no dynamic `import()`. The page
loads only two things from elsewhere: the Google Fonts stylesheet and three.js (an importmap to a pinned CDN build). The
single file has no compiler: `compile.js` is loaded only by a page with a `gemmy-compiler` meta (the hosted site and
`gemmy serve`). The hosted site (`gemmy view --hosted`) is the one place with separate files: the same viewer and
stylesheet, and the compiler, named by their hash.

## How a scene reaches the page

Every scene the page shows is a tab, and a tab's scene has a source (`src/scene/source.ts`, `Source`). `src/main.ts`
makes the page's tabs at startup and the first one is shown; then every way of adding a scene adds a tab (`src/ui/loader.ts`).
The sources:

- **Embedded** (`gemmy view`): the scene is in `#scene-data`. Its link is the view only.
- **Live** (`gemmy serve`, meta `gemmy-mode` = `live`): `scene.json` as the server holds it. While its tab is the one
  shown, a new version (from the server's status events) is loaded in place; another tab pauses that, and choosing the
  live tab again loads it. Its link is the page.
- **URL** (`?scene=`, New tab…): `src/scene/fetch.ts` fetches it. `parseSources` parses the address
  (`src/scene/source.ts`).
- **Home** (no scene open, the file island's `+`, a loader page's start): the start screen. React draws it
  (`src/react/home.tsx`) from the state in `src/ui/home.ts`: the Open card (a file, or one address box for a scene URL or a
  gist) centred on the first screen, and below it the examples of a hosted site (`examples.json` beside the page:
  `src/scene/examples.ts`), each with its thumbnail picture (pre-rendered by `scripts/render_thumbnails.sh`).
  Choosing one there opens it as a tab in place of the home tab.
- **Gist** (`?gist=`): the gist's file, fetched from its raw address.
- **File** (dropped on the page, or Open local file…): read in the browser (`src/scene/read.ts`: gzip by its magic bytes, the
  size cap, the schema check). Its link is the view only.
- **Structure** (a structure file dropped or chosen on a page that compiles, with its sidecars): `src/scene/drop.ts`
  (`sourcesOf`, which uses `groupFiles`) makes one structure tab per structure file, with the other dropped files as its
  sidecars. A file whose name ends in .toml or .json (.gz too) is a sidecar, even when its name matches a structure
  rule (POSCAR.toml). With no structure file, the drop is scene tabs as before. `ui/structure-load.ts` (`loadStructure`)
  loads the compiler (`scene/compiler.ts`: `compile.js`, once, from the page's meta and only from its own site), reads the
  file and its sidecars (each capped; a gzipped sidecar takes the name it has once gunzipped, and a scene among them is
  refused), resolves the LAMMPS types (the tab's map, else the one saved preset that matches, else the card's form), picks
  the config (`compile/files.ts`: a dropped config, else `configs/default.json` with the structure's element styles and
  bonds filled in, `compiler/entry.ts`), checks the
  expanded atom count against `MAX_ATOMS_IN_PAGE` before the neighbour search, and compiles. The tab keeps its
  `StructureModel` (`ui/structure-model.ts`), and `activeModel` is the model the stage shows. Its link is the view only.
  A page without a compiler (a single file, or a bad compiler meta) says so on the card.
- **Attempts** (`ui/attempts.ts`): every load of a tab takes an attempt number. A load checks it after each await and
  before its native work, and stops when it is no longer the tab's latest or the tab is closed, so a closed tab shows
  nothing and the compile does not run for it.
- **Type maps** (`ui/type-map-flow.ts`, `ui/types-needed.ts`, `react/type-map-form.tsx`): a LAMMPS file whose types have
  no element asks the card for a label per type (`TypesNeeded`). Apply cuts the map to the unresolved types and reloads
  the tab with it; a map that does not read keeps the form up with the user's draft and the reason (`TypeMapRejected`).
  A map is kept as a preset (`ui/type-preset-store.ts`, in localStorage) only once its read succeeds. A saved preset is
  applied on its own only when exactly one matches and the file's signature is informative (`isInformative`); otherwise
  the form opens with the matches as suggestions. The signature is the type ids, with the masses and labels when the file
  has them. A saved map that was used gets a note with Undo on the message line (`react/message-line.tsx`), which turns automatic matching off for
  that tab. The form also lists, chooses, renames and deletes the presets, and exports or imports them as a JSON file
  (`ui/type-presets-file.ts`). The pure parts are node-tested.

`nameOf`, `fromOf` and `linkOf` (`source.ts`) give a tab's title, the line under it and its Copy link address.

`src/ui/share.ts` keeps the camera in the address as `#view=` (`src/camera/viewhash.ts` encodes and decodes it) and
restores it once the first scene is shown; Copy link is there too. `src/ui/stage.ts` puts a scene on the stage.

## The hosted site

`gemmy view --hosted` (scripts/build_site.sh) writes one viewer, one stylesheet and the compiler at the site root, named by
the first 10 hex digits of their SHA-256 (`viewer.<hash>.js`, `style.<hash>.css`, `compile.<hash>.js`). Every page references those names, so a new
build never gets an old, cached file under the same name. The names are computed in one place
(`gemmy.site`), and the page writers take them as hrefs. The scene files (`scene.json.gz`) are not hashed.
The one page (`index.html`) is the viewer: a page with `examples.json` beside it opens the start screen (home), and
no scene is open by default. A gallery card opens an example's structure, compiled in the page from its folder
(examples.json's `structure`, through `structureOf`, a `page-structure` source). There is no per-example page and no
`view/`: the page's address options (`?scene=`, `?gist=`) fill the viewer, as on any page.

## Where things are

- `react/`: one file per area of the overlay. `overlay.tsx` mounts them. `top-bar.tsx` (the file island and the island of the toolbar), `file-island.tsx` (the open files), `scroll-chevrons.tsx`, `toolbar.tsx` (the views and the
  turn pad), `export-menu.tsx` (Export), `theme-button.tsx`, `lens-row.tsx`,
  `corner-buttons.tsx` (the details, customize and ? buttons), `inspector-toggle.tsx` (the dock's edge tab), `selection-card.tsx` (the details card), `help.tsx` (the keyboard help), `home.tsx` (the start screen),
  `tip.tsx` (a button with its tip), `inspector/` (the dock: `inspector.tsx` the column and its sections, `dock-section.tsx` the section frame with its fold)
  and `style-panel/` (the structure sections: `pane-model.ts` describes each section's controls as plain data, `tweakpane-adapter.ts`
  is the one module that draws them with Tweakpane, `pane.tsx` mounts the adapter, `sections.tsx` and `cell.tsx` are the sections). Hooks: `use-signal.ts` (reads a signal), `press.ts` (a button that repeats while held) and
  `overflow.ts` (the fade of a scrolling row).
- `components/ui/`, `lib/utils.ts`: the shadcn/ui components and `cn()` (see "Components" above). `input.tsx` and
  `label.tsx` are the form's, copied from the registry the same way.
- `react/type-map-form.tsx`: the LAMMPS type form on the card and the saved presets under it. `react/message-line.tsx`: the
  message line under the toolbar, with a sign for its kind (info, warning, error) and the note's action button (Undo).
- `ui/`: the state and the page's own DOM. `panels.ts` (the dock's open state and focus, the sections' folds, and the phone rule), `readout.ts` (the
  selection's text, as data), `readout-centre.ts` (the card's Center buttons, split out so
  `readout.ts` runs in node), `picking.ts` (clicks and the selection highlight), `pivot.ts` (what a turn turns about),
  `press.ts` (the hold-to-repeat controller), `keyboard.ts` (the keys), `stage.ts` (a scene on the stage, the show flags),
  `views.ts` (the look-along views), `share.ts` (the view in the address, Copy link), `loader.ts` (the tabs and how each
  source loads), `structure-load.ts` (a structure tab's load), `type-resolution.ts` (the map a structure reads with), `load-budgets.ts` (the atom and sidecar budgets), `type-map-flow.ts` (the type form's Apply and the saved-map
  note), `types-needed.ts` (the errors a load throws for the card), `attempts.ts` (which load of a tab is current),
  `tab-bar.ts` (the file island's state) and `tab-model.ts` (the tab list, as plain data), `home.ts` (the start
  screen's state), `live.ts` (the gemmy serve page), `export.ts` (the Export actions), `message.ts` (the message line's notes and standing messages), `theme.ts`,
  `outline-scale.ts`, `overflow.ts` (the edges of a scrolling row), `help.ts` (the keyboard help's open state), `storage.ts`
  (remembered choices), `tooltip.ts` (the hover tips), `dom.ts` (`byId`, and the page's name), `structure-model.ts` (a
  structure tab's model and the shown one), `structure-config.ts` (the style panel's config: the facts it offers, and the
  recompile of the scene when the config changes) and `style-panel-model.ts` (the panel's pure helpers).
- `scene/`: the scene document's loading (above), `load.ts` builds the three.js objects, `bounds.ts` the framing.
- `camera/`: the view, the pivot, the fly and glide moves, the framing numbers (shared with the Blender render).
- `render/`: the renderer, the frame loop, instancing and the triad.
- `export/`, `geom/`, `trace/`: the vector exports (SVG and traced SVG).
- `config.ts` and the placeholders: `__CONSTANTS_JSON__` and `__AXIS_FONTS_JSON__` are filled in by `gemmy.view` (the
  numbers the Blender render uses), so the page and the render agree.

## Tests

`test/entry.ts` re-exports the modules without a DOM. `tests/viewer_bundle.py` bundles it, and the `tests/test_view_*.py`
files run the pure parts in node. The DOM is not tested here: the browser test (`tests/test_browser.py`, `--browser`)
runs the page in headless Chrome, and a change to the overlay is checked there.
The compile side's node tests (`tests/test_ts_*.py`) bundle `test/compile-entry.ts`, which also covers the sidecar lookup
and the config pick (`tests/test_ts_files.py`). The viewer's pure load helpers (attempts, the budgets, the saved-map cut,
the drop's sidecar names) are in `test/entry.ts` and run by `tests/test_ts_load.py`. The browser test drops files on the front page and on a single-file page
(`tests/browser/driver.mjs`, the `drops` and `alert` scenarios), and its goldens for those pages are their own.
