// Reads structure files with fastatoms (the wasm build in web/vendor/fastatoms) into Structure records. The only module
// that imports fastatoms: neighbors.ts builds the supercell neighbour source on the wasm atoms this file opens (through
// withSupercell, readSupercell and neighborPairsOf). Call initStructureReader() once before anything else here.
//
// The glue is imported statically and handed to init(), so the bundle needs no dynamic import of the wasm file.
import { Atoms, init, neighborList, read } from "../../vendor/fastatoms/index.js";
import { native, requireModule } from "../../vendor/fastatoms/module.js";
import createFastAtoms from "../../vendor/fastatoms/wasm/fastatoms.mjs";
import type { AtomRecord, NeighborPairs, NeighborSource, Structure } from "./structure";
import {
  baseName,
  READERS,
  readerFor,
  readerForFormat,
  readerNamed,
  type ReaderEntry,
  type StyleKeys,
} from "./readers";
import { hasCompleteFrame, neutralisedElementColumn } from "./lammps-dump";
import { dataTypeNames, noMapIdentity, tiltsInLabelOrder } from "./lammps-data";
import { extxyzSpecies, vasp4AtomLabels, vasp4CommentSpecies } from "./species-text";
import { hasEntries, type TypeMap, type TypeSignature, typeSignatureOf, unmappedTypes, unresolvedTypes } from "./types";
import { elementOfLabel } from "./elements";
import type { Vec3 } from "../types";

export interface ReadStructureOptions {
  // The file's name: it picks the reader (readers.ts), and it is the structure's comment.
  fileName: string;
  // A reader's name from readers.ts, to skip the name match (for a file whose name does not say its format).
  format?: string;
  // The map of a compile config's `types` key: a strict map (see TypeMap in types.ts). A LAMMPS file must have a type
  // column and every one of its types must be named, else the read fails (checkConfigTypes). It wins over pageTypes.
  configTypes?: TypeMap;
  // A map the page gives (its type form, a saved preset): a lenient map (see TypeMap in types.ts). The types that the
  // map and the file leave without an element are reported in unresolvedTypes, and the page asks for those. Only LAMMPS
  // readers use it.
  pageTypes?: TypeMap;
}

// The map a read uses, and whether it is the config's (strict) or the page's. typeChoice gives undefined for a read with
// no map.
interface TypeChoice {
  map: TypeMap;
  strict: boolean;
}

export interface ReadStructureResult {
  structure: Structure;
  // The LAMMPS types that the map and the file did not resolve. Their atoms have the element X.
  unresolvedTypes: number[];
  // The file's type signature (what a preset of its map is matched against); null for a file with no types.
  typeSignature: TypeSignature | null;
}

export function initStructureReader(): Promise<void> {
  return init(createFastAtoms);
}

// The reader is picked once, and that row both reads the text and says where the style keys come from. The order:
// the explicit `format`; else the format fastatoms guesses from the text alone (content wins over the name, as in ASE);
// else the row whose file name rule matches; else the first row whose format reads the text.
export function readStructure(text: string, options: ReadStructureOptions): ReadStructureResult {
  const name = baseName(options.fileName);
  const choice = typeChoice(options);
  if (options.format !== undefined) return readAs(readerNamed(options.format), text, name, choice);
  // Content first (R5): the text alone is asked, and the name only when the text says nothing.
  const guessed = guessFormat("", text);
  if (guessed !== "") {
    return readAs(readerForFormat(guessed) ?? unlistedReader(guessed), text, name, choice);
  }
  const named = readerFor(name);
  if (named !== undefined) return readAs(named, text, name, choice);
  return readEachRow(text, name, choice);
}

// The config's map when it has entries, else the page's, else no map.
function typeChoice(options: ReadStructureOptions): TypeChoice | undefined {
  if (hasEntries(options.configTypes)) return { map: options.configTypes, strict: true };
  if (hasEntries(options.pageTypes)) return { map: options.pageTypes, strict: false };
  return undefined;
}

// The format fastatoms guesses, or "" when it cannot tell. Only the head of the text is needed for any signature.
const GUESS_HEAD_CHARS = 4096;

function guessFormat(name: string, text: string): string {
  return native(() => requireModule().guessFormat(name, text.slice(0, GUESS_HEAD_CHARS)));
}

function readAs(reader: ReaderEntry, text: string, name: string, choice: TypeChoice | undefined): ReadStructureResult {
  const atoms = openAtoms(text, name, reader, choice);
  try {
    checkStrictMap(atoms, reader, name, choice);
    return describe(atoms, reader, text, name, choice);
  } finally {
    atoms.dispose();
  }
}

// A file fastatoms cannot tell apart: the first row that reads it. A failed read is an ordinary error here, since a
// failed fastatoms call leaves the module usable.
function readEachRow(text: string, name: string, choice: TypeChoice | undefined): ReadStructureResult {
  for (const reader of READERS) {
    let atoms: Atoms;
    try {
      atoms = openAtoms(text, name, reader, choice);
    } catch {
      continue;
    }
    try {
      checkStrictMap(atoms, reader, name, choice);
      return describe(atoms, reader, text, name, choice);
    } finally {
      atoms.dispose();
    }
  }
  throw new Error(
    `cannot read ${name} as a structure: fastatoms cannot tell its format, and no format gemmy reads fits it`,
  );
}

// A format fastatoms guessed that has no row: its atoms are keyed by symbol, and it has no type numbers.
function unlistedReader(fastatomsFormat: string): ReaderEntry {
  return { name: fastatomsFormat, fastatomsFormat, matches: () => false, styleKeys: "symbols", typeNumbers: false };
}

// Read errors carry the file's name, whichever way the format was picked. Before a read, the checks gemmy makes on the
// text itself (R4: a dump with a complete frame; R10: a VASP 4 file's comment names elements).
function openAtoms(text: string, name: string, reader: ReaderEntry, choice: TypeChoice | undefined): Atoms {
  try {
    checkText(text, reader);
    return read(preparedText(text, reader, choice), {
      filename: name,
      format: reader.fastatomsFormat,
      types: reader.typeNumbers ? elementMap(choice?.map) : undefined,
      ...vaspSpecies(text, reader),
      ...cifOptions(reader),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${name} as a structure: ${reason}`);
  }
}

// The checks on the text before fastatoms reads it. A dump with no complete frame is an error (R4).
function checkText(text: string, reader: ReaderEntry): void {
  if (reader.fastatomsFormat === "lammps-dump" && !hasCompleteFrame(text)) {
    throw new Error("no complete frame: every frame ends before its atom rows are complete");
  }
}

// The text fastatoms reads: a data file's tilts in label order (R1), and a dump's element column neutralised under a map
// (R8), since the map decides the element.
function preparedText(text: string, reader: ReaderEntry, choice: TypeChoice | undefined): string {
  if (reader.fastatomsFormat === "lammps-data") return tiltsInLabelOrder(text);
  if (reader.fastatomsFormat === "lammps-dump" && choice !== undefined) return neutralisedElementColumn(text);
  return text;
}

// R12: a CIF file keeps the site of maximum occupancy where sites are disordered (the binding keeps every site otherwise).
function cifOptions(reader: ReaderEntry): { disorder?: string } {
  return reader.fastatomsFormat === "cif" ? { disorder: "max_occupancy" } : {};
}

// R10: a VASP 4 file's species are the words of its comment line, each of which must name an element. The species are
// handed to the reader, which has no species line to read them from.
function vaspSpecies(text: string, reader: ReaderEntry): { species?: string[] } {
  if (reader.fastatomsFormat !== "vasp") return {};
  const species = vasp4CommentSpecies(text);
  if (species === undefined) return {};
  for (const label of species) {
    if (elementOfLabel(label) === undefined) {
      throw new Error(`the VASP 4 comment line names ${label}, which names no element`);
    }
  }
  return { species };
}

// R13 with no map: a data file's types are named by their labels, then their Masses comments, then their type numbers
// (the element of a mass-only type is fastatoms' own, the one its mass names).
function withNoMapNames(structure: Structure, atoms: Atoms, reader: ReaderEntry, text: string): Structure {
  if (reader.fastatomsFormat !== "lammps-data") return structure;
  const names = dataTypeNames(text);
  const types = atoms.getArray("type") as Float64Array;
  return {
    ...structure,
    atoms: structure.atoms.map((atom, k) => {
      const { element, key } = noMapIdentity(names, types[k]);
      return key === undefined ? atom : { ...atom, element: element ?? atom.element, styleKey: key };
    }),
  };
}

// R11: an extended XYZ's species column decides each atom's element and style key, over a Z column (fastatoms reads Z).
function withExtxyzSpecies(structure: Structure, reader: ReaderEntry, text: string): Structure {
  const species = reader.fastatomsFormat === "extxyz" ? extxyzSpecies(text) : undefined;
  if (species === undefined || species.length !== structure.atoms.length) return structure;
  return {
    ...structure,
    atoms: structure.atoms.map((atom, k) => ({
      ...atom,
      element: elementOfLabel(species[k]) ?? atom.element,
      styleKey: species[k],
    })),
  };
}

// R10: a VASP 4 file's atoms are keyed by the labels of its comment line (fastatoms keys them by symbol).
function withVasp4Labels(structure: Structure, reader: ReaderEntry, text: string): Structure {
  const labels = reader.fastatomsFormat === "vasp" ? vasp4AtomLabels(text) : undefined;
  if (labels === undefined || labels.length !== structure.atoms.length) return structure;
  return { ...structure, atoms: structure.atoms.map((atom, k) => ({ ...atom, styleKey: labels[k] })) };
}

// The structure and, for a LAMMPS file, its unresolved types. The caller disposes the atoms.
function describe(
  atoms: Atoms,
  reader: ReaderEntry,
  text: string,
  name: string,
  choice: TypeChoice | undefined,
): ReadStructureResult {
  const keys: StyleKeys = typeof reader.styleKeys === "function" ? reader.styleKeys(text) : reader.styleKeys;
  const structure = withExtxyzSpecies(withVasp4Labels(toStructure(atoms, name, keys), reader, text), reader, text);
  // Only a LAMMPS file has a type array, and it is numeric.
  if (!(reader.typeNumbers && atoms.arrays.includes("type"))) {
    return { structure, unresolvedTypes: [], typeSignature: null };
  }
  const labelled =
    choice === undefined ? withNoMapNames(structure, atoms, reader, text) : labelAtoms(structure, atoms, choice.map);
  const labels = atoms.getLabels();
  const typeArray = atoms.getArray("type") as Float64Array;
  const masses = atoms.arrays.includes("masses") ? (atoms.getArray("masses") as Float64Array) : null;
  return {
    structure: labelled,
    unresolvedTypes: unresolvedTypes(labels, typeArray),
    typeSignature: typeSignatureOf(labels, typeArray, masses),
  };
}

// The map fastatoms reads with: each label replaced by the element it names by gemmy's rule. fastatoms refuses some labels
// that the rule accepts ("d1"), so its labels are not used; labelAtoms gives the atoms their labels after the read.
function elementMap(map: TypeMap | undefined): TypeMap | undefined {
  if (map === undefined) return undefined;
  return Object.fromEntries(Object.entries(map).map(([type, label]) => [type, elementOfLabel(label) ?? label]));
}

// With a map, each atom's style key is its type's label and its element is the one that label names (gemmy's rule, as
// the type form checks labels). A dump's element column does not override the map. An atom whose type the map leaves
// out (a page's map may) keeps fastatoms' dummy element and its type number.
function labelAtoms(structure: Structure, atoms: Atoms, map: TypeMap): Structure {
  const types = atoms.getArray("type") as Float64Array;
  return {
    ...structure,
    atoms: structure.atoms.map((atom, k) => {
      const label = map[types[k]];
      if (label === undefined) return atom;
      return { ...atom, element: elementOfLabel(label) ?? atom.element, styleKey: label };
    }),
  };
}

// The config's map is checked before the file is described, so its refusal comes before any check of the cell.
function checkStrictMap(atoms: Atoms, reader: ReaderEntry, name: string, choice: TypeChoice | undefined): void {
  if (choice?.strict) checkConfigTypes(atoms, reader, name, choice.map);
}

// A config's map must suit the file: the file must be a LAMMPS data or dump file, have a type column, and have every one
// of its types named by the map. The messages name the file and the types.
function checkConfigTypes(atoms: Atoms, reader: ReaderEntry, name: string, map: TypeMap): void {
  if (!reader.typeNumbers) {
    throw new Error(
      `${name}: \`types\` names LAMMPS types, but ${name} is not a LAMMPS data or dump file. Its name needs a data or ` +
        "dump part, such as mgo.data, dump.step or a .lammpstrj suffix.",
    );
  }
  if (!atoms.arrays.includes("type")) {
    throw new Error(`${name} has no type column, so its \`types\` map does not apply to it.`);
  }
  const missing = unmappedTypes(atoms.getArray("type") as Float64Array, map);
  if (missing.length > 0) {
    throw new Error(
      `${name}: LAMMPS types [${missing.join(", ")}] have no label. Name each in the config's \`types\` key, ` +
        `e.g. \`${missing[0]} = "Fe1"\`.`,
    );
  }
}

// A cell with less volume has no cell: the compile works in fractional coordinates. The same bound as record.py's.
const NO_VOLUME = 1e-9;

// The cell must have a volume: the compile works in fractional coordinates.
function toStructure(atoms: Atoms, name: string, keys: StyleKeys): Structure {
  if (Math.abs(atoms.getVolume()) < NO_VOLUME) {
    throw new Error(`${name} has no cell; give it a lattice (non-periodic axes can be a box around the atoms).`);
  }
  const cell = atoms.cell;
  const lattice: [Vec3, Vec3, Vec3] = [triple(cell, 0), triple(cell, 3), triple(cell, 6)];
  const [px, py, pz] = atoms.pbc;
  const symbols = atoms.getChemicalSymbols();
  const styleKeys = keys === "labels" ? atoms.getLabels() : symbols;
  const scaled = atoms.getScaledPositions({ wrap: false });
  const records: AtomRecord[] = symbols.map((element, k) => ({
    element,
    fractional: triple(scaled, 3 * k),
    styleKey: styleKeys[k],
  }));
  return { comment: name, lattice, pbc: [px, py, pz], atoms: records };
}

// Three numbers from a flat array, from offset `at`.
function triple(values: ArrayLike<number>, at: number): Vec3 {
  return [values[at], values[at + 1], values[at + 2]];
}

// The base of a supercell for withSupercell: the lattice rows, the element symbols, and the Cartesian positions (flat,
// three numbers per atom).
export interface SupercellBase {
  lattice: [Vec3, Vec3, Vec3];
  symbols: string[];
  positions: number[];
}

// Builds the supercell's wasm atoms from a base, with the periodic flags set, hands them to `use`, and frees them after.
// The base atoms are freed once the repeat is made; the supercell is freed when `use` returns or throws.
export function withSupercell<T>(
  base: SupercellBase,
  supercell: readonly number[],
  periodic: readonly boolean[],
  use: (atoms: Atoms) => T,
): T {
  const pbc: [boolean, boolean, boolean] = [periodic[0], periodic[1], periodic[2]];
  const unit = Atoms.fromArrays({ symbols: base.symbols, positions: base.positions, cell: base.lattice, pbc });
  try {
    const repeated = unit.repeat([supercell[0], supercell[1], supercell[2]]);
    try {
      repeated.setPbc(pbc);
      return use(repeated);
    } finally {
      repeated.dispose();
    }
  } finally {
    unit.dispose();
  }
}

// The cell, the positions, the scaled positions and the symbols of supercell atoms, as plain rows (the labels are added
// by neighbors.ts, which knows the structure's labels).
export function readSupercell(atoms: Atoms): Omit<NeighborSource, "neighbors" | "labels"> {
  const count = atoms.length;
  const cell = atoms.cell;
  const positions = atoms.getPositions();
  const scaled = atoms.getScaledPositions({ wrap: false });
  return {
    cell: [triple(cell, 0), triple(cell, 3), triple(cell, 6)],
    positions: Array.from({ length: count }, (_, k) => triple(positions, 3 * k)),
    scaled: Array.from({ length: count }, (_, k) => triple(scaled, 3 * k)),
    symbols: atoms.getChemicalSymbols(),
  };
}

// The neighbour pairs of atoms within a cutoff (fastatoms' "ijSd" list).
export function neighborPairsOf(atoms: Atoms, cutoff: number): NeighborPairs {
  return neighborList("ijSd", atoms, cutoff);
}
