# The viewer (web/)

The page that `gemmy view` and `gemmy serve` write is built from here: TypeScript modules (`src/`), the page template
(`page.html`) and the stylesheet (`style.css`). `npm --prefix web run build` writes the built files to
`src/gemmy/viewer/`, which is what ships in the wheel; never edit those. Dev only, not in the wheel.

    npm --prefix web ci         # once
    npm --prefix web run build  # after a change here: commit the built files too
    npm --prefix web run check  # tsc
    npm --prefix web run lint   # Biome (biome.json): lint and format check; no writes
    npm --prefix web run format # Biome: writes the formatting

Biome's `noNonNullAssertion` is off: the viewer reads ids and points out of a scene that `gemmy` has already
checked (`check_references`), so a Map lookup for one is known to hit, and a guard for each would hide a broken scene.
Biome's import sorting (`organizeImports`) is off: the imports stay in the order the code is written.

## How a scene reaches the page

Every scene the page shows is a tab, and a tab's scene has a source (`src/scene/source.ts`, `Source`). `src/main.ts`
makes the page's tabs at startup and the first one is shown; then every way of adding a scene adds a tab (`src/ui/loader.ts`).
The sources:

- **Embedded** (`gemmy view`, the examples' own pages): the scene is in `#scene-data`. Its link is the view only.
- **Live** (`gemmy serve`, meta `gemmy-mode` = `live`): `scene.json` as the server holds it. While its tab is the one
  shown, a new version (from the server's status events) is loaded in place; another tab pauses that, and choosing the
  live tab again loads it. Its link is the page.
- **URL** (`?scene=`, the page's `gemmy-default-scene` metas, Open URL…): `src/scene/fetch.ts` fetches it. A default's
  link is the page, since the page opens it. `sourcesToOpen` parses the address (`src/scene/source.ts`) or the defaults:
  several open as tabs, which is the front page; one is an example's page.
- **Gist** (`?gist=`): the gist's file, fetched from its raw address.
- **File** (dropped on the page, or Open scene…): read in the browser (`src/scene/read.ts`: gzip by its magic bytes, the
  size cap, the schema check). Its link is the view only.

`nameOf`, `fromOf` and `linkOf` (`source.ts`) give a tab's title, the line under it and its Copy link address.

`src/ui/share.ts` keeps the camera in the address as `#view=` (`src/camera/viewhash.ts` encodes and decodes it) and
restores it once the first scene is shown; Copy link is there too. `src/ui/stage.ts` puts a scene on the stage.

## The hosted site

`gemmy view --hosted` (scripts/build_site.sh) writes one viewer and one stylesheet at the site root, named by the first
10 hex digits of their SHA-256 (`viewer.<hash>.js`, `style.<hash>.css`). Every page references those names, so a new
build never gets an old, cached file under the same name. The names are computed in one place
(`gemmy.view._shared_files`), and the page writers take them as hrefs. The scene files (`scene.json.gz`) are not hashed.
The front page (`index.html`) is the viewer too, with every example's scene as a default tab; `view/` is the viewer with
no scene, and each example's page has its own scene as its one default.

## Where things are

- `scene/`: the scene document's loading (above), `load.ts` builds the three.js objects, `bounds.ts` the framing.
- `camera/`: the view, the pivot, the fly and glide moves, the framing numbers (shared with the Blender render).
- `render/`: the renderer, the frame loop, instancing and the triad.
- `ui/`: the toolbar and menus, the readout, the picking, the loader (the tabs and the card), `stage.ts` (putting a
  scene on the stage), `live.ts` (the serve page's status and follow note), the share menu, the toast.
- `export/`, `geom/`, `trace/`: the vector exports (SVG and traced SVG).
- `config.ts` and the placeholders: `__CONSTANTS_JSON__` and `__AXIS_FONTS_JSON__` are filled in by `gemmy.view` (the
  numbers the Blender render uses), so the page and the render agree.

## Tests

`test/entry.ts` re-exports the modules without a DOM. `tests/viewer_bundle.py` bundles it, and the `tests/test_view_*.py`
files run the pure parts in node. The DOM is not tested here: check a change in a browser.
