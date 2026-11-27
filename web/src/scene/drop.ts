// What a drop or a file choice holds, grouped: the structure files (each one a structure tab, read by its format's
// row in structure/readers.ts) and the rest, which every structure takes as its sidecars (its config, labels and
// displacement files). With no structure file, the rest are the scene files, opened as scene tabs as before. Pure, so
// the node tests cover it; the files are any objects, named by `nameOf`.
import { readerFor, type ReaderEntry } from "../structure/readers";
import { unzippedName } from "./read";
import type { Source } from "./source";

export interface StructureFile<T> {
  file: T;
  reader: ReaderEntry;
}

export interface DroppedFiles<T> {
  // One per structure file, in the order dropped.
  structures: StructureFile<T>[];
  // Every other file, in the order dropped.
  others: T[];
}

// The extensions of a file that is a sidecar by its kind: TOML and JSON, gzipped or not. A POSCAR.toml is a config, so
// it is a sidecar even though its name matches the POSCAR rule.
const SIDECAR_EXTENSIONS = [".toml", ".json"];

export function isSidecarName(name: string): boolean {
  const plain = unzippedName(name).toLowerCase();
  return SIDECAR_EXTENSIONS.some((extension) => plain.endsWith(extension));
}

// A structure file is one whose name a format's row takes and that is not a sidecar.
function structureReaderOf(name: string) {
  return isSidecarName(name) ? undefined : readerFor(name);
}

export function groupFiles<T>(files: readonly T[], nameOf: (file: T) => string): DroppedFiles<T> {
  const structures: StructureFile<T>[] = [];
  const others: T[] = [];
  for (const file of files) {
    const reader = structureReaderOf(nameOf(file));
    if (reader === undefined) others.push(file);
    else structures.push({ file, reader });
  }
  return { structures, others };
}

// The tabs' sources for files that were dropped or chosen: each structure file is a structure source, with the other
// files as its sidecars; with no structure file, every file is a scene file (a file source).
export function sourcesOf(files: readonly File[]): Source[] {
  const { structures, others } = groupFiles(files, (file) => file.name);
  if (structures.length === 0) return others.map((file): Source => ({ kind: "file", file }));
  return structures.map(({ file }): Source => ({ kind: "structure", file, sidecars: others }));
}
