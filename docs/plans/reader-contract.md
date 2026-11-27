# The structure-reading contract

Reading a structure file gives a `Structure`: three lattice rows (Å), and per atom an element, fractional coordinates
and a style key. The atoms are in ascending id order (a file with no id column keeps its row order). gemmy decides what
a read must give, and three readers are held to it: the ASE backend (`src/gemmy/readers`, ASE), the fastatoms backend
(the Python binding), and the page's reader (`web/src/structure`, fastatoms in wasm). None of them is the reference.

The rules are checked on the synthetic cases in `tests/fixtures/reader-contract` (`tests/test_reader_contract.py`).
Each case is named by the rule it tests, and its expected values are worked out by hand, never read from a reader.

Formats: LAMMPS data (`.data`, `.lmp`, `data.*`), LAMMPS dump (`.dump`, `.lammpstrj`, `dump.*`), VASP (POSCAR,
CONTCAR, `.vasp`), extended XYZ (`.xyz`, `.extxyz`), CIF (`.cif`). The rules below cover these five. R14 covers the rest.

## Cell and positions

**R1 Origin and cell.** Positions are measured from the box origin. A data file's origin is its header's `xlo ylo zlo`
(or the `abc origin` line of a general triclinic box). A dump's origin comes from its BOX BOUNDS: for a tilted box those
bounds are the bounding box, so the origin is `x = xlo_bound - min(0, xy, xz, xy+xz)`, `y = ylo_bound - min(0, yz)`,
`z = zlo_bound`. A general triclinic box (`avec`, `bvec`, `cvec` lines with `abc origin`) gives its lattice rows as
written. Tilt values are read by their labels (`xy`, `xz`, `yz`), whatever their place on the line.
Reason: LAMMPS writes absolute coordinates, so a read that does not start from the origin shifts every atom. The
bounding-box rule is how LAMMPS writes a tilted box, and a rotated cell has no restricted form at all, so the general
form is the only way to hold it. A label names its tilt, so the position of a value on the line carries no meaning.

**R2 Image flags are not applied.** A data file's image flags (the three integers after an atom's coordinates) and a
dump's `ix iy iz` columns are ignored: positions are read as written.
Reason: the periodic image policy belongs to compile, which wraps atoms and chooses the images to show. A reader that
unwraps the positions decides that policy for the user and hides what the file's positions are.

**R3 Coordinate columns, per frame.** For each frame, take the first complete triplet in this order: `x y z`,
`xs ys zs`, `xu yu zu`, `xsu ysu zsu`. A triplet is complete when all three of its columns are in that frame. Scaled
columns are fractions already measured from the origin, so they are used as they are. Frames may differ in their
columns and origins, and each frame uses its own.
Reason: the unwrapped and scaled forms are the same positions as `x` up to the origin and the image flags, so `x` is
the position the file states and the others are its derivations. A fixed order is the tie-break that the Python
readers and the page share, so they cannot disagree on a file that has both.

## Dumps and frames

**R4 Frames.** A dump is scanned block by block. A frame begins at its `ITEM: TIMESTEP` block. Metadata blocks
(`ITEM: TIME`, `ITEM: UNITS`) may appear in a frame's header and are not rows. A frame is complete when each of its
`ITEM: ATOMS` rows (the count is in `ITEM: NUMBER OF ATOMS`) is a full row of the columns named in the `ITEM: ATOMS`
line. A frame that is cut short (the tail of a dump still being written, or a row stopped mid-line with no newline
after it) is dropped. The last complete frame is read. A dump with no complete frame is an error whose text contains
`no complete frame`.
Reason: LAMMPS appends frames while a run goes on, so the last frame of a file being read is often cut, and the last
complete frame is the latest state the file holds. The block layout is the format itself, and LAMMPS writes its
metadata blocks in the header, so a reader that stops at an unknown block would lose the frame.

## Formats and names

**R5 Format: content first.** The format is decided from the text when the text has a strong signature: a dump's first
block is `ITEM: TIMESTEP` (lammps-dump); a data file has a header line `N atoms`, `N atom types`, `xlo xhi` or
`abc origin` (lammps-data); a POSCAR has a scale number on line 2 and three numbers on each of lines 3 to 5 (vasp); an
extended XYZ has `Lattice=` on line 2 (extxyz); a CIF starts with `data_` (cif). Only when the text has none of these
does the file name decide (R6). Gzip is detected by the two magic bytes `1f 8b`, never by the name.
Reason: a file name is a label someone typed, and it is often wrong (a `dump.step` copied from a POSCAR, a data file
saved as `.txt`). The text is what the reader parses, so it decides. The magic bytes are the one certain sign of gzip,
and a `.gz` name can be a lie in either direction.

**R6 Names.** A file name is literal: an `@` is part of the name, never a frame selector (`POSCAR@1` is a POSCAR named
with an `@`). The name's `.gz` suffix is dropped in any case (`.GZ`) before the format is matched. The page and the
Python readers match the same suffixes and name prefixes (`.data`, `.lmp`, `data.`, `.dump`, `.lammpstrj`, `dump.`,
POSCAR, CONTCAR, `.vasp`, `.xyz`, `.extxyz`, `.cif`).
Reason: the name is what the user typed. Both ASE and the fastatoms binding read `name@N` as frame N, which is not what
the user meant by a file named that way.

**R14 Other formats.** A file in a format outside the five (ASE's own formats, such as `.traj`) is read by the ASE
backend, by ASE's guess from the name. The fastatoms backend and the page refuse it.
Reason: gemmy accepted these formats before the contract; the ASE backend keeps them, and the fastatoms reader and the
page only read what they are written for, so an unknown format is refused there with its name, not guessed.

## Types, maps and labels

**R7 Type labels.** In a data file, an atom's type may be written as a label, in any atom style (atomic, full,
molecular: the type is the column the style gives it), and the Masses section may name a type by its label. The label
resolves to its number by the `Atom Type Labels` section. The atoms come out in ascending id, whatever the order of
their rows.
Reason: LAMMPS accepts a label wherever the numeric type goes, so the label has to resolve before any type is used. The
id is the atom's identity in LAMMPS, and a config's atom references depend on the order; a read that keeps the rows as
written would make a reference depend on how the file was written.

**R8 The map.** A `types` map from the config decides each atom's element and style key (the map's label). It is
applied before any element column or mass in the file is used, and an element column whose symbol names no element does
not fail a mapped read.
Reason: the map is the user's decision. The file's element or mass columns can be stale, or describe a potential other
than the one the user means, so they must not override the map. An unknown symbol in a column the map has overridden
cannot matter.

**R9 A label's element.** The element of a label is gemmy's rule (`gemmy.elements.element_of_label`): the leading letters
name it. `Fe_pv` and `fe` are Fe, `Hx` is H, `D1` is H (deuterium), `Xc` is the dummy X, `O2-` is O. A label that names no
element is an error that names the label.
Reason: one element rule for every label gemmy reads (a map, a POSCAR species, a Masses comment, a CIF type symbol), so
that a map and a POSCAR written for the same species agree.

**R10 POSCAR.** A VASP 5 species line (line 6) names the species, and each species label is the style key of its atoms;
the element is the label's element (R9). The counts line (line 7) may carry a comment after `!`. A VASP 4 file has no
species line: its species are the words of the comment (line 1) if every one of them names an element (R9), and it is an
error that names the word otherwise. No POTCAR or OUTCAR is read for species.
Reason: the POSCAR is the structure, so the species it names are the species of the structure. A POTCAR or an OUTCAR
is another file, and its species can disagree with the POSCAR it is paired with. The label is the user's name for the
species (`Fe_pv` keeps its pseudopotential), so it stays the key.

**R11 Extended XYZ.** The `Lattice=` header is the cell. Each atom's species symbol is its element and its style key. A
`Z` column is not used when a species column is present: it is the second copy of the same fact.
Reason: the species is what the writer named the atom. A `Z` column can be copied from another file and disagree with it,
and when they disagree the species is the one the file's own tools (ASE) take as the symbol.

**R12 CIF.** The cell comes from the `_cell_` lines. A site's element is the element of its type symbol (R9); the atom
labels (`Na1`) are dropped, and the style key is the element symbol. A disordered site (sites at one position, with
occupancies that share it) keeps the site with the largest occupancy, at that site's place in the file's order.
Reason: a scene shows one atom per place, so the occupant with the largest share is the one the structure is most
likely to hold. Labels are numbering of the sites, not species names, so they are not keys.

**R13 No map.** Without a map, each type takes its element and style key from the first of these that applies:
1. an `Atom Type Labels` entry: the label is the key, and its element is R9's;
2. a Masses comment that names an element (`# Mg`, `# Mg1`): the element it names (R9), and the comment's text is the key;
3. a mass within 0.1 u of exactly one element: that element, and the label is the type number (a mass alone names
   no label, so a mass-only type is labelled by its number);
4. otherwise the dummy X, keyed by the type number.
For a dump, step 2 is its element column: a symbol that names an element gives the element, and the key is the symbol.
A type number outside 1 to 118 never indexes an element table, so it falls to step 4 unless a label or comment names it.
Reason: a name the author wrote for a type is the author's decision, so it outranks any inference. A comment is the
author's intent for that type, while a mass is an inference, so the comment wins when they disagree. A mass identifies an
element only when it is within 0.1 u of one, and an unknown type is the dummy X rather than a guess, so the reader never
invents a species. Keying an unnamed type by its number keeps unnamed types apart.
