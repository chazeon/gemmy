# Reader contract fixtures

One folder per case. Each has one input file and `expected.json`, computed by hand from the design values (never
produced by a reader). `expected.json` holds `types` (the config's map, when the case uses one), `lattice` (three rows,
Å), `elements`, `style_keys` and `fractional` (rounded to 6 decimals), or `error` (a substring the error must contain).
The rules are in docs/plans/reader-contract.md. Each case's name starts with the rule it tests.

Cell: orthorhombic 4 Å unless the case says otherwise. "Atoms at (x, y, z)" below are the file's own coordinates.
The page reads each input as its raw bytes (a gzip file is gunzipped by the page's own decoder, by its magic bytes).

- R1-data-origin-tilted: restricted triclinic data file, origin (-1, 2, 0.5), tilt xy=-1, xz=0.5, yz=0.25. Atoms written
  as absolute positions; the origin must be subtracted. Lattice rows (4 0 0), (-1 4 0), (0.5 0.25 4).
- R1-data-tilt-order: the same cell with its tilt line `0.5 -1.0 0.25 xz xy yz`: each value is read by its label.
- R1-data-general-triclinic: the same cell as a general triclinic file (`abc origin`, `avec`, `bvec`, `cvec`).
- R1-data-rotated-triclinic: a general triclinic cell that has no restricted form: A = (2 2 0), B = (0 2 2), C = (2 0 2),
  origin (-1, 2, 0.5). Atom 1 at (-0.25, 3.5, 1.75) is fraction (0.25, 0.5, 0.125); atom 2 is (0.75, 0.25, 0.5).
- R1-dump-origin: the same box as a tilted dump, whose BOX BOUNDS are the bounding box (xlo_bound -2, not the origin -1).
- R2-data-image-flags: image flags 1 0 0 and 0 1 0; atom 1 is written at x = 5.0 and must read as 1.25, not wrapped
  (0.25) nor unwrapped (2.25).
- R2-dump-image-flags: the same as a dump with ix iy iz columns.
- R3-dump-column-precedence: a frame with x y z (1.0) and xs ys zs (0.5); the plain columns win (0.25).
- R3-dump-frames-vary: two complete frames; the first has xs ys zs in a 0..4 box, the last has x y z in a 1..5 box.
  The last frame is read with its own columns and origin.
- R3-dump-mixed-x-xs: x and y are present, z is not: the x y z triplet is incomplete, so xs ys zs (fractions, with the
  origin not subtracted) are used. The box origin is 1.
- R4-truncated-tail: three frames, the last one with one atom row of two; the second frame is read.
- R4-cut-row: the last frame's second row stops mid-line with no newline; that frame is dropped, the first is read.
- R4-single-frame-short: one frame, two atoms declared, one row: no complete frame (error).
- R4-time-blocks: ITEM: TIME and ITEM: UNITS blocks in each frame; the last frame (time 0.5) is read.
- R5-literal-filename: `POSCAR@1` is a POSCAR named with an `@`, not frame 1 of a POSCAR.
- R5-gzip-by-magic: gzipped bytes in a file with no format suffix (`structure.dat`); the magic bytes and the data header
  decide.
- R5-content-over-name: an extended XYZ text in a file named `structure.data`: the content decides.
- R6-gzip-case: `box.DATA.GZ`, gzipped, upper case; read as the data file it holds.
- R7-type-labels: data file whose Atoms rows name their types `Fe` and `O`, declared in an `Atom Type Labels` section,
  with the map `1 = Fe1`, `2 = O`.
- R7-type-labels-permuted: type ids 2 then 1 in Atom Type Labels, labels in Masses, atom ids and rows permuted; no map.
  Atoms come out in ascending id.
- R7-type-labels-full: a full-style Atoms section (`id mol type q x y z`) whose type column is the label; no map.
- R8-map-over-mass: the Masses comments say Mg and O; the map says Fe1 and O, and the map wins.
- R8-map-over-element-column: a dump whose element column says Mg; the map says Fe1 and wins.
- R8-map-unknown-element-column: an element column of `Qz` (no element) under a map: the map decides and the read works.
- R9-label-elements: six labels, each giving an element by gemmy's rule (`Fe_pv`, `Xc`, `Hx`, `D1`, `fe`, `O2-`).
- R9-no-element: a map label `Qq` names no element; the error names it.
- R10-poscar-species-labels: a VASP 5 species line `Fe_pv O`: style keys keep the labels, elements are Fe and O.
- R10-poscar-count-comment: the same, with a count line `1 1 ! one of each`.
- R10-poscar-vasp4-comment: a VASP 4 POSCAR whose comment line is `Fe_pv O`: the species come from the comment.
- R10-poscar-vasp4-comment-no-element: the comment `Qq O` names no element: the error names `Qq`.
- R10-poscar-no-element: a POSCAR species label `Qq` names no element; the error names it.
- R11-extxyz-symbols: an extended XYZ with a Lattice header; keys are the symbols.
- R11-extxyz-z-disagrees: the Fe atom's Z column says 8; the species Fe decides.
- R12-cif-labels: a CIF whose atom labels (`Na1`, `Cl1`) are dropped; the type symbols give the keys.
- R12-cif-disorder: Fe at occupancy 0.3 and Co at 0.7 on one site: Co (the larger) is kept.
- R13-nomap-data-masses: no map; the Masses comments name the elements (24.305 is Mg, 15.999 is O).
- R13-nomap-masses-disagree: the comment `# Mg1` on a type whose mass is O's: the comment wins, its text is the label.
- R13-nomap-mass-no-comment: no comments; 24.305 is within 0.1 u of Mg only, so Mg, keyed by its type number.
- R13-nomap-dump-element: no map; the dump's element column gives Mg and O.
- R13-nomap-dump-multi-types: no map, no element column: three atoms of types 1, 2, 2 are dummy X keyed 1, 2, 2.
- R13-nomap-unnamed-types: no map and no masses: the type has no element and is the dummy X keyed by its number 1.
- R13-type-119: type 119 (past the element table) with a mass of 50.0 that is within 0.1 u of no element: dummy X, keyed 119.
