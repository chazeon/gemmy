# The viewer (web/)

The page that `gemmy view` and `gemmy serve` write is built from here: TypeScript modules (`src/`), the page template
(`page.html`) and the stylesheet (`style.css`). `npm --prefix web run build` writes the built files to
`src/gemmy/viewer/`, which is what ships in the wheel; never edit those. Dev only, not in the wheel.

    npm --prefix web ci         # once
    npm --prefix web run build  # after a change here: commit the built files too
    npm --prefix web run check  # tsc

## How a scene reaches the page

`src/main.ts` starts the page one of three ways, decided by what the page carries:

- **Embedded** (`gemmy view`, the examples' own pages): the scene is in `#scene-data`.
- **Live** (`gemmy serve`, meta `gemmy-mode` = `live`): the page fetches `scene.json` and follows the server's events.
- **Loader** (`view/` on the site, and the examples' pages, mode `load`): `src/ui/loader.ts` opens the scene named by
  `?scene=` or `?gist=` (`src/scene/source.ts` parses them; `src/scene/fetch.ts` fetches), else the page's
  `gemmy-default-scene`, else the empty state. It also takes a dropped file or Open scene… (`src/scene/read.ts`: gzip by
  its magic bytes, the size cap, the schema check).

`src/ui/share.ts` keeps the camera in the address as `#view=` (`src/camera/viewhash.ts` encodes and decodes it) and
restores it once the first scene is shown; Copy link is there too.

## The hosted site

`gemmy view --hosted` (scripts/build_site.sh) writes one viewer and one stylesheet at the site root, named by the first
10 hex digits of their SHA-256 (`viewer.<hash>.js`, `style.<hash>.css`). Every page references those names, so a new
build never gets an old, cached file under the same name. The names are computed in one place
(`gemmy.view._shared_files`), and the page writers take them as hrefs. The scene files (`scene.json.gz`) are not hashed.

## Where things are

- `scene/`: the scene document's loading (above), `load.ts` builds the three.js objects, `bounds.ts` the framing.
- `camera/`: the view, the pivot, the fly and glide moves, the framing numbers (shared with the Blender render).
- `render/`: the renderer, the frame loop, instancing and the triad.
- `ui/`: the toolbar and menus, the readout, the picking, the loader, the share menu, the toast.
- `export/`, `geom/`, `trace/`: the vector exports (SVG and traced SVG).
- `config.ts` and the placeholders: `__CONSTANTS_JSON__` and `__AXIS_FONTS_JSON__` are filled in by `gemmy.view` (the
  numbers the Blender render uses), so the page and the render agree.

## Tests

`test/entry.ts` re-exports the modules without a DOM. `tests/viewer_bundle.py` bundles it, and the `tests/test_view_*.py`
files run the pure parts in node. The DOM is not tested here: check a change in a browser.
