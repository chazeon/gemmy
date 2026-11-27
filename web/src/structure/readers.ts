// The formats gemmy reads, one row each. A file name picks its row (matches); a row says which fastatoms format reads
// it and where the style keys come from. Adding a format is adding a row.
import { vaspStyleKeys } from "./species-text";

// Whether a row's atoms are keyed by the labels fastatoms keeps, or by their chemical symbols.
export type StyleKeys = "labels" | "symbols";

export interface ReaderEntry {
  // gemmy's name for the format, which a caller can pass as `format`.
  name: string;
  // The format name fastatoms reads it with.
  fastatomsFormat: string;
  // Whether a file name belongs to this format.
  matches(fileName: string): boolean;
  // The style keys: fixed for the format, or decided per file from its text.
  styleKeys: StyleKeys | ((text: string) => StyleKeys);
  // Whether the file uses LAMMPS type numbers, so a TypeMap applies.
  typeNumbers: boolean;
}

// The last part of a path, with either slash.
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// The lower-case extension of a file name, with a trailing .gz dropped first (as fastatoms does for a guess).
function extensionOf(fileName: string): string {
  const bare = baseName(fileName).replace(/\.gz$/i, "");
  const dot = bare.lastIndexOf(".");
  return dot <= 0 ? "" : bare.slice(dot).toLowerCase();
}

function hasExtension(fileName: string, extensions: readonly string[]): boolean {
  return extensions.includes(extensionOf(fileName));
}

function nameStartsWith(fileName: string, prefix: string): boolean {
  return baseName(fileName).toLowerCase().startsWith(prefix);
}

// structure.is_vasp: a .vasp file, or a name with POSCAR or CONTCAR in it (any case).
function isVasp(fileName: string): boolean {
  const upper = baseName(fileName).toUpperCase();
  return hasExtension(fileName, [".vasp"]) || upper.includes("POSCAR") || upper.includes("CONTCAR");
}

export const READERS: readonly ReaderEntry[] = [
  { name: "vasp", fastatomsFormat: "vasp", matches: isVasp, styleKeys: vaspStyleKeys, typeNumbers: false },
  {
    name: "extxyz",
    fastatomsFormat: "extxyz",
    matches: (fileName) => hasExtension(fileName, [".xyz", ".extxyz"]),
    styleKeys: "symbols",
    typeNumbers: false,
  },
  // CIF labels are dropped here, as the ASE path drops them.
  {
    name: "cif",
    fastatomsFormat: "cif",
    matches: (fileName) => hasExtension(fileName, [".cif"]),
    styleKeys: "symbols",
    typeNumbers: false,
  },
  {
    name: "lammps-data",
    fastatomsFormat: "lammps-data",
    matches: (fileName) => hasExtension(fileName, [".data", ".lmp"]) || nameStartsWith(fileName, "data."),
    styleKeys: "labels",
    typeNumbers: true,
  },
  {
    name: "lammps-dump",
    fastatomsFormat: "lammps-dump",
    matches: (fileName) => hasExtension(fileName, [".dump", ".lammpstrj"]) || nameStartsWith(fileName, "dump."),
    styleKeys: "labels",
    typeNumbers: true,
  },
];

// The first row whose rule matches the file name, or undefined: the caller then tries each row.
export function readerFor(fileName: string): ReaderEntry | undefined {
  return READERS.find((reader) => reader.matches(fileName));
}

// Formats fastatoms guesses under a different name from the row that reads them: its plain XYZ (no extended header)
// is read by the extxyz row, as a named .xyz file is.
const READ_AS: Readonly<Record<string, string>> = { xyz: "extxyz" };

// The row for a format fastatoms guessed from the name and the text, or undefined for a format with no row (such as
// XDATCAR): the caller reads that one with an unlisted row.
export function readerForFormat(fastatomsFormat: string): ReaderEntry | undefined {
  const target = READ_AS[fastatomsFormat] ?? fastatomsFormat;
  return READERS.find((reader) => reader.fastatomsFormat === target);
}

// The row with this gemmy name. An unknown name is an error, not a fallback.
export function readerNamed(name: string): ReaderEntry {
  const reader = READERS.find((entry) => entry.name === name);
  if (reader === undefined) {
    const known = READERS.map((entry) => entry.name).join(", ");
    throw new Error(`unknown structure format ${JSON.stringify(name)}; use one of ${known}`);
  }
  return reader;
}
