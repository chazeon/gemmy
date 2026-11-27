// The files a compile names (the config, a label file, a displacement file), as text by name. Node reads them from
// disk in the tests; the page takes them from the dropped files. The names are the ones the config writes (relative to
// the config's folder in Python), so a lookup is by the name as written. The sidecars a structure is dropped with are
// classified here too (sidecarKind), so the page can tell a config from a label or displacement file.
import { readData } from "./datafile";

// A file a config names is not among the files given; the message names it and lists the ones there are.
export class MissingFileError extends Error {}

// A name a config gives matches more than one dropped file; the message names them all.
export class AmbiguousFileError extends Error {}

// A file given with a structure: the name it was dropped under, and its text.
export interface SidecarFile {
  name: string;
  text: string;
}

// A path as a config writes it, relative to the config's folder. The dropped files have no folders, so the config's folder
// is the root here: "./labels.json" and "sub/../labels.json" are "labels.json". A path that climbs above the root keeps its
// leading "..".
export function normalizeName(ref: string): string {
  const out: string[] = [];
  for (const part of ref.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const baseOf = (name: string): string => name.slice(name.lastIndexOf("/") + 1);

// The dropped files a name a config writes refers to: the exact normal names first, else every file with the base name
// (the dropped files have no folders). Empty when none matches.
function matchesOf(files: readonly SidecarFile[], name: string): SidecarFile[] {
  const wanted = normalizeName(name);
  const exact = files.filter((file) => normalizeName(file.name) === wanted);
  if (exact.length > 0) return exact;
  return files.filter((file) => baseOf(normalizeName(file.name)) === baseOf(wanted));
}

// Several config files could be the config and none is named for the structure. The message names them.
export class ConfigPickError extends Error {}

export interface FileSource {
  // The text of a file, by name; undefined when the source does not hold it.
  read(name: string): string | undefined;
  // Every name the source holds, for error messages.
  names(): string[];
}

// A FileSource over the given files (a list, so two dropped files with one name both stay). A name is looked up as the
// config wrote it (normalizeName), first among the names exactly, then by its base name; a name that several files match
// is an AmbiguousFileError.
export class MapFileSource implements FileSource {
  private readonly files: readonly SidecarFile[];

  constructor(files: readonly SidecarFile[] | Readonly<Record<string, string>>) {
    this.files = Array.isArray(files) ? [...files] : Object.entries(files).map(([name, text]) => ({ name, text }));
  }

  read(name: string): string | undefined {
    const matches = matchesOf(this.files, name);
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      const named = matches.map((file) => file.name).join(", ");
      throw new AmbiguousFileError(`${name} matches several dropped files: ${named}; drop only one of them`);
    }
    return matches[0].text;
  }

  names(): string[] {
    return this.files.map((file) => file.name).sort();
  }
}

// The text of a file the config names; MissingFileError when the source does not hold it.
export function requireFile(files: FileSource, name: string, what: string): string {
  const text = files.read(name);
  if (text !== undefined) return text;
  const held = files.names();
  const listed = held.length > 0 ? held.join(", ") : "none";
  throw new MissingFileError(
    `${what} ${name} is named by the config but was not given; the files given are: ${listed}`,
  );
}

// A file given with a structure, by what its content says (pickConfig and the page use it):
//   "scene"         a gemmy scene (schema_version): it is opened on its own, never a sidecar;
//   "labels"        a label file: an index -> label map, a label -> indices map, or either under `labels`;
//   "displacements" a displacement file: a `vectors` list;
//   "data"          a TOML or JSON file that can be a config (the candidates of pickConfig);
//   "other"         any file that is not TOML or JSON.
export type SidecarKind = "scene" | "labels" | "displacements" | "data" | "other";

const CONFIG_EXTENSIONS = [".toml", ".json"];

function stemOf(name: string): string {
  return name.replace(/\.[^./\\]*$/, "");
}

// The name a config for a structure is saved under: the structure's stem with the format's extension (POSCAR.toml, or
// stishovite.json for stishovite.cif). pickConfig matches it to the structure by that stem.
export function configNameFor(structureName: string, format: "toml" | "json"): string {
  return `${stemOf(structureName)}.${format}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One label entry's index: an int, or a "lo-hi" range (what labels.ts reads).
const INDEX_ITEM = /^\s*\d+(?:_\d+)*\s*(?:-\s*\d+(?:_\d+)*\s*)?$/;

// A table that is a label map: at least one entry, and every entry is an index -> label pair or a label -> index list.
// A config's own tables (`labels = { file = "..." }`, `bonds = [...]`) have other shapes, so they are not label maps.
function isLabelTable(table: Record<string, unknown>): boolean {
  const entries = Object.entries(table);
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => {
    if (typeof value === "string") return /^\d+$/.test(key);
    return Array.isArray(value) && value.length > 0 && value.every((item) => INDEX_ITEM.test(String(item)));
  });
}

// What a sidecar is, from its name and its text (see SidecarKind). A file that does not parse is a "data" candidate: its
// error comes when the config is read, and it may be the config itself.
export function sidecarKind(name: string, text: string): SidecarKind {
  if (!CONFIG_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) return "other";
  let data: unknown;
  try {
    data = readData(name, text);
  } catch {
    return "data";
  }
  if (!isRecord(data)) return "data";
  if (Object.hasOwn(data, "schema_version")) return "scene";
  if (Array.isArray(data.vectors)) return "displacements";
  if (isRecord(data.labels) ? isLabelTable(data.labels) : isLabelTable(data)) return "labels";
  return "data";
}

// The file names a config refers to, which are not configs themselves (its label and displacement files).
function namesReferencedBy(text: string, name: string): string[] {
  let data: unknown;
  try {
    data = readData(name, text);
  } catch {
    return [];
  }
  if (!isRecord(data)) return [];
  const labels = isRecord(data.labels) ? data.labels.file : undefined;
  const vectors = isRecord(data.displacements) ? data.displacements.data_file : undefined;
  return [labels, vectors].filter((ref): ref is string => typeof ref === "string" && ref !== "").map(normalizeName);
}

// The config candidates named for the structure: `config.*`, or `<structure stem>.*`.
function namedConfigs(candidates: readonly SidecarFile[], structureName: string): SidecarFile[] {
  const wanted = new Set(["config", stemOf(structureName).toLowerCase()]);
  return candidates.filter((file) => wanted.has(stemOf(file.name).toLowerCase()));
}

// The candidates that no config refers to: a label or displacement file a config names is left out, whatever its shape.
function unreferencedCandidates(candidates: readonly SidecarFile[], files: readonly SidecarFile[]): SidecarFile[] {
  const referenced = new Set(
    candidates.flatMap((file) => namesReferencedBy(file.text, file.name).flatMap((name) => matchesOf(files, name))),
  );
  return candidates.filter((file) => !referenced.has(file));
}

// The config for a structure, by name among the given sidecars:
//   1. `config.*`, or `<structure stem>.*`, when exactly one such file is given;
//   2. else the only config candidate, once the files a config refers to (its label and displacement files) are left
//      out. A label file or a displacement file is never a candidate, whatever its name;
//   3. else an error that names the candidates (ConfigPickError), or null when there is no candidate at all, in which
//      case the caller uses the default config.
export function pickConfig(files: readonly SidecarFile[], structureName: string): SidecarFile | null {
  const candidates = files.filter((file) => sidecarKind(file.name, file.text) === "data");
  const named = namedConfigs(candidates, structureName);
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    const all = named.map((file) => file.name).join(", ");
    throw new ConfigPickError(`several config files match ${structureName}: ${all}; drop all but one`);
  }
  const left = unreferencedCandidates(candidates, files);
  if (left.length === 1) return left[0];
  if (left.length === 0) return null;
  const all = left.map((file) => file.name).join(", ");
  throw new ConfigPickError(
    `${structureName} has several config candidates: ${all}; name one config.toml or config.json`,
  );
}
