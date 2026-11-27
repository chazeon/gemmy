# The viewer's UI rules

What the page shows, where it sits, and how it behaves. Every UI change follows this file, and a change of rule edits it first. The owner's decisions are written as rules. "Why" lines say what a rule is protecting.

## Principles
- **Library first.** Use stock shadcn/ui (Radix) components on Tailwind v4 for the overlay, Tweakpane for the style dock, and Lucide for icons. Theme them with variables. Restyle only where a rule below says so; no hand-built widgets.
- **Defaults unless a rule says otherwise.** A control takes its component's default size, padding and radius. The exceptions are listed here, each with its reason.
- **Neutral palette.** The page's colours are shadcn's neutral palette, softened a step (a grey page, brighter islands, a darker dock in light and a lighter one in dark), light and dark, as tokens on `:root` in web/style.css (the sidebar's among them). Change a colour there, never in a component.
- **Islands.** Every floating group of controls is an `.island`: the same background, radius, shadow and inner padding. Islands sit `--gap` apart, inside the page inset.
- **One centre line per row.** Controls on one row share a height (36 px, h-9) and a centre line. The browser layout test checks this.
- **One focus style.** A focused control shows shadcn's ring: 3 px, the accent at half (`focus-visible:ring-[3px] focus-visible:ring-ring/50`), with no outline. Stock Buttons have it. A hand-made focusable (the Open file drop zone, a gallery card, a Tweakpane button or input) gets the same ring, with `outline-none`. The page has no global outline rule.
- **Measure, don't guess.** A layout change is checked against the real DOM (getBoundingClientRect) at 1280×800 and 393×852, and the numbers are reported.
- **One popup at a time.** Opening a menu, dropdown or popover closes any other.

## Layers
The z-order is one table of tokens on `:root` (web/style.css). Anything new picks one of these, never a number of its own:

| Token | Value | What |
| --- | --- | --- |
| `--z-home` | 0 | the start screen (`#home`), under the islands |
| `--z-stage` | 1 | the axis triad, over the stage (inside `main`) |
| `--z-island` | 1 | the islands, the toolbar column and the phone's corner island |
| `--z-layer` | 2 | the island layer (`#ui`), over the stage |
| `--z-float` | 2 | the details card and the phone sheets, the edge tab and the scroll chevrons |

The Radix popovers (the menus, the help) take `z-50` from their components, above all of these.

The start screen is a page state, not a view: `html[data-scene="none"]` (set by ui/home.ts, read by the CSS and the `no-scene:hidden` variant). With no scene the toolbar, the lens row, the corner buttons, the details card, the dock, the edge tab and Export are hidden; `html[data-scene="shown"]` is a scene.

What takes the pointer in the layer, all of it by one rule: the islands, the elements with the `.hit` class (the start screen, the
message line, the edge tab) and the two sheets (`#info`, `#inspector`). The layer and the stage behind it take none, so a drag on
the bare page reaches the stage.

## Top bar (left to right)
There is no main menu. Its jobs live where they belong: New tab is the file island's (+), Open file… is on the start screen (and dropping a file works anywhere), and Copy link is in the Export menu.

1. **File island**: which file you are looking at, and a way to switch.

   You see the current file's name on a button: a `FileBox` icon, the name, and a small ⌄. Click it and a list of your open files drops down. The one you are on has a check, and each file you may close has an × at the end of its row. Pick a name to go to that file. Close the one you are on, and you land on its neighbour, the one to its right, or else to its left. The list holds files only, with no icons on its rows, so it reads as a plain list of names. With the list open, the arrow keys move along its rows, and Delete or Backspace on a row closes that file as its × does; the focus then goes to the file button.

   To open something else, there is a narrow (+) after a thin separator. It takes you to the start screen, where you pick an example from the gallery, choose a file, or drop one. While you are there, the file button reads New tab with the `FilePlusCorner` icon. The list still shows only your files, none of them checked, since you are not on any of them.

   The New tab is a place you pass through, not a tab you keep:
   - pick something there, and it becomes that file;
   - go back to a file from the list instead, and the New tab quietly closes;
   - there is never more than one, so the (+) hides while you are on it and comes back once you have left;
   - only when nothing else is open (the front page before you choose, or after you close your last file) does the New tab stay.

   With opening turned off and a single file, there is nothing to switch to or add. The island then just shows the file's icon and name, in the same box and height as the button would have, with no ⌄ and no (+).

   How it looks:
   - every island in the row has the same height and centre line;
   - the (+) is a slim pill (about 20×36, a 14 px Plus);
   - the separator sits midway between the ⌄ and the +, and the + has as much space to its right, to the island's edge, as to its left, from the separator (measured to the icons' visible edges);
   - the separator is the toolbar's divider.
   - the file button's right padding is at most half its default, so the ⌄ sits close to the button's edge.
2. **Toolbar island** (centre): view and camera buttons in groups, with the island's own separators between groups. When it is too narrow and its row scrolls, a chevron appears on each edge that has more, for a mouse only, and only while the toolbar is shown.
3. **Export island** (right): the theme button and Export, in one `.island` like the others. Both are stock shadcn buttons at their default sizes (36 px): the theme button a ghost `size="icon"`, Export the default button with its label. The island's 4 px padding makes it the top bar's 44 px height and centre line. The Export menu starts with Copy link, then a separator, then the exports, and opens aligned to its button.

## Message line
- Every page message is one line attached under the toolbar island: the live follow note, live compile and Blender errors, Blender progress, and timed notes such as Undo prompts. There are no separate cards, banners or toasts.
- Shape: the island's width, joined to it, with no gap. The island's bottom corners and the line's top corners are square, with one hairline between. About 30 px tall, one line, cut off with an ellipsis; the full text is in its title.
- Kind: info, warning or error. GitHub Primer flash style:
  - a tinted background (the kind at about 10%);
  - the hairline in the kind's stronger tone;
  - a Lucide sign in the kind's colour (Info, TriangleAlert, CircleAlert);
  - the text in the normal foreground;
  - the action (Undo) a small text button in the kind's colour at the right end.
  Colours are tokens on `:root`, with dark-mode values. Text meets WCAG AA.
- A read's notes show as a warning on load. A structure with partly occupied sites (R12) shows one warning on the message
  line when it loads, worded by `partialNote` (web/src/structure/partial.ts); `gemmy compile` warns with the same text
  (`partial_note` in readers/record.py). It is a timed note like the load's other warnings, so it shows once per load.
- With several messages live, the line shows the most important: error, then warning, then info. A timed note wins a tie. API: `note(text, {kind, action, ms})` for timed notes; `setStanding(name, text|null, kind)` for messages that stay until their owner clears them.

## Right side: the dock and its tab (wide screens, 641 px and up)
- **Dock**: the stock shadcn Sidebar (`components/ui/sidebar.tsx`, default variant), flush at the window's right edge, full height, in the sidebar tokens of the neutral palette. It has no title and no close button. It is for detailed style editing only. Sections, in order:
  1. View: Atoms, Outlines, Cell box and Axes toggles, and Outline width. Shown for every file. Axes shows or hides the a b c
     triad on the page and in the PNG and SVG exports, so an export has the triad exactly when the page shows it. Like Cell box,
     it is not remembered: a page load starts with it on.
  2. Atoms, Bonds, Shapes and Cell, for a structure (a file compiled in the page), not for a ready-made scene.
  On the New tab there is no file, so the dock and its edge tab are hidden.
  There is no Selection section; the details card shows the selection.
- **Push**: with the dock open on a wide screen (with a scene), the island layer ends at the dock's left edge (`right: var(--dock-width)`), and the stage keeps its full size and moves left by half the dock's width (a transform: no resize, no refit, no change of zoom, picking maps through the canvas's rect), which keeps the structure centred in the part the dock leaves. Both slide with the dock over `--slide-duration` (200 ms, linear). The live triad is laid out with an inset of that half width, so it stays in view; exports have none and keep the full canvas. Nothing slides on load: `--slide-duration` is 0 until the first paint is done.
- **Shortcut and rail**: the dock has no keyboard shortcut and no hover rail. The edge tab is its one toggle.
- **Section header**: the chevron hangs 9 px outside the section's text edge, and the title sits exactly in line with the row labels below it. The "+" (add) follows the title, small and muted. The count sits alone at the right edge, so counts line up in one column.
- **Edge tab** (`#inspector-tab`, labelled and tipped "Customize"): opens and shuts the dock. It has no keyboard shortcut.
  - Shut, it is a horizontal tab, `[<][sliders]`, level with the Export island (the islands' height, 44 px), with the islands' radius on the left, square on the edge side, and the islands' shadow. The icons are 16 px with a 6 px gap and 6 px padding.
  - At rest it peeks 4 px past the page's edge. On hover or keyboard focus it slides out whole (over 200 ms; with reduced motion, at once), and its "Customize" tip shows. On touch (`hover: none`) it is always whole.
  - The dock's state is one attribute, `html[data-dock="open|shut"]`, which the CSS and the browser driver read (`waitForDock`). Everything that slides with the dock uses `--slide-duration` (0 until `data-ready`, 200 ms after, 0 for reduced motion), linear.
  - A tooltip takes no pointer events and shuts when the pointer leaves its trigger: the edge tab's tip lies over the Export island and must not swallow a press on Export.
  - Its hit area includes the part at the screen's edge.
  - Open, it is a slim chevron-only tab (`[>]`, 18 px wide) flush at the dock's left edge, at the same height and shadow. The Export island keeps a margin for it.
  - On the New tab it is hidden, with the dock.
  - A phone has no edge tab: its customize button opens the dock.
- **Clicking an object** does two things at once: it opens the details card (see below), and, if the dock is open, it opens and highlights the style folder that draws it, found by label. On a phone only one sheet is open at a time, so there a pick shows the details card and the dock sheet closes.
- **Style rows** use stock Tweakpane, themed only by its variables, keeping the library's edges and folder rail. Every colour row takes transparency: its picker has an alpha slider, and its hex is 8-digit (`#rrggbbaa`) at any alpha. Why: the format follows what the colour styles, not its current value, so a solid shape can be made transparent.

## Bottom right: the corner island
- **Desktop**: `[details | ?]`.
  - details: Lucide `Info` icon, key `i`; it opens and shuts the details card. (Not `Shapes`: Shapes is a dock section.)
  - ?: the keyboard help popover.
  When the dock is open, the island moves left of it, with the dock's width and no gap (its right edge is the dock's left edge).
- **Details card**: the selection's details (the old info card), floating above the corner island. Its right edge is the island's, open or shut, and it slides with the dock over the same 200 ms. A pick opens it.

## Phone (640 px wide or less)
The phone width is `PHONE_MAX_WIDTH` in web/src/ui/layout-modes.ts; the page's layout is `html[data-mode="phone|wide"]`, which follows it. The CSS literals of the phone and the wide rules are checked against that constant by tests/test_ui_breakpoints.py.

- The bottom-right island sits level with the bottom-left lens row: `[details | customize | ?]`.
  - customize (Lucide `SlidersHorizontal`) opens the dock as a bottom sheet.
  - The edge tab is hidden.
- The details card and the dock are bottom sheets above that row. Only one is open at a time. A tap on an atom opens the details card.
  Both are the `.sheet` class (web/style.css): one box, inset by the gutter, with a drag that pans the sheet and never the stage.
- There is no horizontal page scroll. The lens row (folded or not) and the corner island never overlap.

## Opening files: one switch
- One flag, `allowOpen` (web/src/ui/open-files.ts), turns these on and off together:
  - the (+);
  - the start screen's Open file… button and drop hint;
  - accepting dropped files (no drop outline when off).
- It is off by default on `gemmy view` and `gemmy serve` pages and on for the hosted site. `?open=1` turns it on and `?open=0` turns it off. Why: opening other files is a back door, not the page's job.
- On a serve page, the (+) opens the start screen without the address box, since a serve page has no address loader.

## Names and colours of atoms
- An atom's species label as written (`C_dna`, `H1`) is its identity everywhere: styles, bond, shape and ring rules, the Atoms section, the readout, selection and search. A rule for `C` does not match `C_dna`.
- The element is used only for chemistry defaults: default colour and radius, and automatic detection (bonds, polyhedra, rings). Detection emits its rules by label ("C_dna 6-ring").
- Colour scheme: Jmol for molecules, VESTA for crystals (periodic structures), with a per-browser choice of Auto or any scheme in the registry (`web/src/compile/schemes/registry.ts`), listed after Auto in registry order. A stored choice that names no scheme is Auto.
- Automatic shapes:
  - Polyhedra for crystals, rings for molecules, coloured by the centre atom.
  - Solid (alpha 1).
  - The centre atom and the bonds the shape covers are hidden.

## Behaviour rules from the UI audit (owner chose 1–7)
1. **Escape order.** Escape first lets a focused editor handle it. Then it closes the open popup (there is at most one: the file list, the Export menu or the help), else the focused phone sheet. A further unhandled press clears the selection and pivot.
2. **Files remember their view.** Each open file keeps its own camera, selection and pivot. Switching back to it restores them, and picking the current file again changes nothing.

3. **Keep the selection after an edit.** After a live refresh or a style edit, the selected object is restored by its identity if it still exists. If it was removed, the selection and pivot are cleared.


4. **Phone sheets.** Both phone sheets (details and customize) have a visible close button and are non-modal. On a phone they start closed. Panel choices are remembered separately for desktop and phone.


5. **Copy link on the start screen** copies the page URL without a camera pose. On a scene, Copy link includes that scene's current view.
6. **Last file.** Closing a file never strands you. With opening on, closing the last file leaves the New tab (see File island). With opening off, the last file cannot be closed.
7. **Touch targets, on touch only.** On a touch device (`@media (pointer: coarse)`, which covers phones and tablets), every visible action is at least 24×24 CSS px. The extra area may be invisible, so the controls look the same. Desktop sizes stay as designed.

## Deferred (not now)
8. **Keyboard access**, for another day:
   - tabs as a WAI-ARIA tablist and the view controls as a toolbar, with arrow navigation within each;
   - a keyboard object finder that picks by species label or reference;
   - scene shortcut keys scoped to the focused scene.

## Capture mode

`?capture=1` (read once, in `web/src/ui/capture.ts`) shows the stage alone, for scripts and tests. The overlay is not mounted, so
there is no top bar, file island, toolbar, message line, dock, edge tab, corner island, details card, lens row or start screen;
the page's keyboard, picking and file openers are off; `data-dock` is always `shut`, so the stage is never moved for a dock; the axis triad is not drawn (the page or the PNG); and a scene shows no
selection highlight. The page still loads a scene the usual ways (embedded, `?scene=`, a structure with config). In this mode
`window.gemmy` exists (`web/src/ui/capture-api.ts`, a facade over the view signals and `ui/export.ts`; not installed otherwise):

- `ready()`: resolves when the first scene is shown, the page has revealed itself and one frame is drawn.
- `openExample(name)`: opens a gallery example as its card does and resolves once it is drawn (a hosted site's page).
- `set({ atoms, box, axes, outlines, outlineWidth, theme, transparent, view })`: sets what is given and requests a render. `theme` is
  `"light"` or `"dark"`, `outlineWidth` is 0.5, 1 or 1.75, `transparent` removes the page background, `view` is the `#view` string.
- `rendered()`: asks for a frame and resolves after it is drawn.
- `export("png" | "svg", options)`: the picture, not downloaded: a `Blob` (PNG, 2x the stage; `options.transparent`, default true)
  or the SVG text. The config and settings exports are not in the API.
- `state()`: `{ atoms, box, axes, outlines, outlineWidth, theme, transparent, view, size }`.
