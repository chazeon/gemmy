# Stage 6 design: the style panel

The panel edits a structure tab's config, never its scene, and the tab recompiles from that config (ts-compile.md §7).
Three layers, each in its own files so agents can work on them in parallel:

## 1. Edits (pure, `web/src/compile/config-edit.ts`)

An edit is a plain function `(config: SceneConfig, ...args) => SceneConfig`. It returns a new config and never mutates
its argument. Every result goes through the schema (`parseSceneConfig(configToData(next))`), so an edit can never
produce a config that Python rejects. A rejected edit throws `ConfigError`, and the panel shows the message.

- Elements (a key is a label or an element, as `styleFor` looks them up): `setElementVisible`, `setElementColor`,
  `setElementRadius`.
- Bonds, by rule index: `setBondWindow(config, index, min, max)`, `setBondVisible`, `setBondColor`, `setBondRadius`,
  `setBondStyle`, `addBondRule(config, a, b, min, max)`, `removeBondRule`.
- Polyhedra: `setPolyhedronVisible`, `setPolyhedronColor`, `setPolyhedronCenter`, `setPolyhedronWindow`,
  `setPolyhedronLigands`, `addPolyhedronRule(config, center, ligands, min, max)`, `removePolyhedronRule`.
- Clusters: `setClusterVisible`, `setClusterColor`, `setClusterWindow`, `setClusterAtoms`, `setClusterKind` (a new kind
  drops the member counts, so the schema fills that kind's defaults: a molecule's null max_size becomes a ring's 7),
  `addClusterRule(config, kind, atoms, min, max)`, `removeClusterRule`.
- Cell: `setSupercell(config, [na, nb, nc])`, `setBox(config, axis, [lo, hi] | null)`, `setPeriodic(config, axis, flag)`.
  The axes x, y, z are the fractional axes along a, b and c of the supercell, in tuple order.

## 2. What the structure offers (pure, `web/src/compile/pair-distances.ts`)

- `presentNames(structure)` gives the labels and elements present, which are the only names a new rule can use.
- `pairDistances(source, cutoff)` gives, for each unordered element pair, the sorted distances that occur up to
  `cutoff`. The bond slider's range and its tick marks come from these.
- `distanceHistogram(distances, bins)` gave counts for a small inline histogram under a slider. It is dropped for now:
  Tweakpane's interval has none. It can return as a Tweakpane plugin (a blade drawn over the interval's track).

## 3. The panel (React and Tweakpane, `web/src/react/style-panel/`)

The dense controls are Tweakpane 4 with its essentials plugin (the interval). React draws the dock and each section's
frame (`react/inspector/dock-section.tsx`, `react/inspector/inspector.tsx`); the sections in `sections.tsx` (Atoms, Bonds,
Shapes) and `cell.tsx` each draw their own frame over one pane. The panel keeps no state of its own beyond the Add row.

Three files, so the library can change in one place:

- `pane-model.ts` is plain data, no UI import. `atomsNodes`, `bondsNodes`, `shapesNodes` and `cellNodes` take (config,
  names, distances) and an `apply` (the `applier` of `ui/style-panel-model.ts`), and return nodes: `folder`, `checkbox`,
  `color`, `number`, `interval`, `text`, `list`, `button`. Each value node holds the value it shows and a `commit` that
  runs one config edit. A rejected edit throws `ConfigError`, and `apply` sends its message to the section.
- `tweakpane-adapter.ts` is the only module that imports Tweakpane. It keeps one pane per section. A change of structure
  (a rule added or removed, a name changed) rebuilds it; a change of values only writes the values into the bindings, so
  open folders and focus stay. A commit runs when Tweakpane reports the end of a change (`ev.last`), so a drag does not
  recompile on every frame.
- `pane.tsx` mounts the adapter on a div and disposes it on unmount. `useEdits` gives a section its `apply`: a rejected
  edit re-renders the section, so the pane shows the config's value again.

The sections:

- **Atoms**: a folder per name, with Show (checkbox), Colour (a colour picker, RGBA from 0 to 1, collapsed) and Radius.
- **Bonds**: a folder per rule, titled "O–Si": Show, Window (an interval from zero to past the pair's farthest distance,
  step 0.01), Radius, Colour, Style (solid, dashed, dotted) and Remove. The header's + opens a "New bond" folder with two
  atom lists and Add bond. The list picks are the section's state until Add bond commits the rule.
- **Shapes**: a folder per polyhedron or cluster, titled "Fe (O, F) · polyhedron" or "C, H · molecule": Centre (a list)
  and Ligands (a comma-separated text) or Kind and Atoms, then Show, Window, Colour and Remove. The + opens "New shape".
  Atoms are typed as text and checked against the structure's names, so a name it lacks is reported rather than kept.
- **Cell**: a folder per lattice vector: Supercell (1 to 10), Periodic, Box from and Box to; and a Reset box button.

The descriptions are checked in node (`tests/test_view_style_pane.py` reads `pane-model.ts` for rocksalt). The adapter
needs a DOM and no browser test drives the panel yet.

## 4. Wiring (after stage 4b merges)

- The structure tab's `config` signal (`ui/structure-model.ts`) is the panel's `config`.
- An effect recompiles on each change and calls `updateScene`, which keeps the camera.
- A failed recompile shows a toast and keeps the previous scene.
- Export config and Export scene read the active model.
- A browser test drags a bond slider and checks the bond count.
