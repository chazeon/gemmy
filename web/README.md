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

- **React** (`src/react/`) draws every control over the canvas: the top bar (the ☰ button with the page's name, or the tab
  strip in its place, and the view toolbar), Export and the theme button, the lens and zoom column, the selection card, the
  corner buttons, the keyboard help and the start screen. `overlay.tsx` mounts them into `#overlay` in page.html
  (`display: contents`, so each island is a grid item of `#ui`).
- **Plain TypeScript** does the rest and never imports React: the scene's loading and framing (`scene/`), the camera and its
  moves (`camera/`), the renderer, the frame loop and the triad (`render/`), the vector exports (`export/`, `trace/`), the
  pure geometry (`geom/`) and the numbers the Blender render shares (`config.ts`). The `ui/` modules hold the viewer's state,
  and the parts of the page that no component draws: the picking and the selection highlight, the stage's keys and pointer,
  the tabs' loading, the start screen's state, the live page's banner, the toast and the theme on `<html>`.

## Signals bridge the two

The state is `@preact/signals-core` signals: `state.ts` (the loaded scene, the show flags, the camera) and the `ui/` modules
(`infoOpen` in `panels.ts`, the `readout`, the theme, the start screen's `card`, the tab strip's `tabBar`). A signal is the
source of truth. A component reads one with `useSignal(signal)` (`src/react/use-signal.ts`), a subscription through
`useSyncExternalStore`, not a second store. A component acts by calling a plain function (`toggleInfo()`, `cycleTheme()`),
which changes the signal.

Where a DOM step has to wait until React has drawn a change, the module sets a request signal and the component takes it
once drawn: `infoFocus` (`ui/panels.ts`, the focus after the card folds or opens) and the address box's focus
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

- `tailwind.css` is Tailwind v4: the theme and the utilities, with no preflight, so `style.css` still styles the rest of the
  page as it did.
- `style.css` is the page's own stylesheet, in the `legacy` layer: the tokens for both themes, the island grid, the start
  screen's cards, the fade of a scrolling row and the phone rules. Its phone width must match `PHONE_MAX_WIDTH` in
  `ui/panels.ts`.
- `build.mjs` bundles `src/main.ts` with React into `viewer.js` (minified, `process.env.NODE_ENV` set to production, three.js
  external), compiles `tailwind.css` with the Tailwind CLI, and writes the stylesheet as the Tailwind layers followed by
  `style.css` in `legacy`. It copies `page.html` with a generated-file comment.

## The single file

`gemmy view` writes one HTML file that opens from disk. `src/gemmy/view.py` puts the built `style.css` and `viewer.js` into
page.html's `/*__STYLE__*/` and `//__SCRIPT__` markers. So the bundle is one script and the stylesheet is one file: no code
splitting, no imports that esbuild would write out beside it (stylesheets, images, fonts), and no dynamic `import()`. The page
loads only two things from elsewhere: the Google Fonts stylesheet and three.js (an importmap to a pinned CDN build). The
hosted site (`gemmy view --hosted`) is the one place with separate files: the same viewer and stylesheet, named by their hash.

## How a scene reaches the page

Every scene the page shows is a tab, and a tab's scene has a source (`src/scene/source.ts`, `Source`). `src/main.ts`
makes the page's tabs at startup and the first one is shown; then every way of adding a scene adds a tab (`src/ui/loader.ts`).
The sources:

- **Embedded** (`gemmy view`, the examples' own pages): the scene is in `#scene-data`. Its link is the view only.
- **Live** (`gemmy serve`, meta `gemmy-mode` = `live`): `scene.json` as the server holds it. While its tab is the one
  shown, a new version (from the server's status events) is loaded in place; another tab pauses that, and choosing the
  live tab again loads it. Its link is the page.
- **URL** (`?scene=`, the page's `gemmy-default-scene` metas, New tab…): `src/scene/fetch.ts` fetches it. A default's
  link is the page, since the page opens it. `sourcesToOpen` parses the address (`src/scene/source.ts`) or the defaults:
  one is an example's page. The address overrides the defaults.
- **Home** (no scene open, the `+` of the tab strip, a loader page's start): the start screen. React draws it
  (`src/react/home.tsx`) from the state in `src/ui/home.ts`: the Open card (a file, or one address box for a scene URL or a
  gist) centred on the first screen, and below it the examples of a hosted site (`examples.json` beside the page, else at
  the site's root: `src/scene/examples.ts`), each with its thumbnail picture (pre-rendered by `scripts/render_thumbnails.sh`).
  Choosing one there opens it as a tab in place of the home tab.
- **Gist** (`?gist=`): the gist's file, fetched from its raw address.
- **File** (dropped on the page, or Open local file…): read in the browser (`src/scene/read.ts`: gzip by its magic bytes, the
  size cap, the schema check). Its link is the view only.

`nameOf`, `fromOf` and `linkOf` (`source.ts`) give a tab's title, the line under it and its Copy link address.

`src/ui/share.ts` keeps the camera in the address as `#view=` (`src/camera/viewhash.ts` encodes and decodes it) and
restores it once the first scene is shown; Copy link is there too. `src/ui/stage.ts` puts a scene on the stage.

## The hosted site

`gemmy view --hosted` (scripts/build_site.sh) writes one viewer and one stylesheet at the site root, named by the first
10 hex digits of their SHA-256 (`viewer.<hash>.js`, `style.<hash>.css`). Every page references those names, so a new
build never gets an old, cached file under the same name. The names are computed in one place
(`gemmy.view._shared_files`), and the page writers take them as hrefs. The scene files (`scene.json.gz`) are not hashed.
The front page (`index.html`) is the viewer too: a page with `examples.json` beside it opens the start screen (home), and
its default scenes are not opened. `view/` is the viewer with no scene (home, with the examples from the site root), and
each example's page has its own scene as its one default.

## Where things are

- `react/`: one file per area of the overlay. `overlay.tsx` mounts them. `top-bar.tsx` (the ☰ button and the name or the tab
  strip, and the island of the toolbar), `main-menu.tsx` (the ☰ menu), `tab-strip.tsx`, `toolbar.tsx` (the views and the
  turn pad), `export-menu.tsx` (Export), `theme-button.tsx`, `lens-column.tsx`, `info-card.tsx` (the selection card),
  `corner-buttons.tsx` (the (i) and ? buttons), `help.tsx` (the keyboard help), `home.tsx` (the start screen), `tip-button.tsx`
  (a button with its tip). Hooks: `use-signal.ts` (reads a signal), `press.ts` (a button that repeats while held) and
  `overflow.ts` (the fade of a scrolling row).
- `components/ui/`, `lib/utils.ts`: the shadcn/ui components and `cn()` (see "Components" above).
- `ui/`: the state and the page's own DOM. `panels.ts` (which folds are open, and the phone rule), `readout.ts` (the
  selection's text, as data), `picking.ts` (clicks and the selection highlight), `pivot.ts` (what a turn turns about),
  `press.ts` (the hold-to-repeat controller), `keyboard.ts` (the keys), `stage.ts` (a scene on the stage, the show flags),
  `views.ts` (the look-along views), `share.ts` (the view in the address, Copy link), `loader.ts` (the tabs and how each
  source loads), `tab-bar.ts` (the tab strip's state) and `tab-model.ts` (the tab list, as plain data), `home.ts` (the start
  screen's state), `live.ts` (the gemmy serve page), `export.ts` (the Export actions), `toast.ts`, `theme.ts`,
  `outline-scale.ts`, `overflow.ts` (the edges of a scrolling row), `menus.ts` (the keyboard help's open state), `storage.ts`
  (remembered choices), `tooltip.ts` (the hover tips) and `dom.ts` (`byId`, and the page's name).
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
