// The LAMMPS type map a structure reads with. The config's map wins (strict: its errors are the config's). Otherwise the
// page's map is used (the form's, or a preset the form gave). Otherwise a file whose types have no element takes the one
// saved preset that matches, or else the card asks for the types (TypesNeeded). A map that does not read is a
// TypeMapRejected. See TypeMap in structure/types.ts for the two kinds of map.
import type { Compiler } from "../scene/compiler";
import { errorText } from "../errors";
import type { ReadStructureResult } from "../structure/fastatoms";
import type { Structure } from "../structure/structure";
import { isInformative, hasEntries, restrictMap, type TypeMap, type TypeSignature } from "../structure/types";
import { presetList } from "./type-preset-store";
import { matchingPresets } from "./type-presets";
import { ConfigFileError, TypeMapRejected, TypesNeeded } from "./types-needed";

// The part of the compiler a structure's types are read with (resolveTypes takes it, so a test can pass the reader alone).
export type StructureReader = Pick<Compiler, "readStructure">;

// What a structure's compile left for the page to say: a saved map that was used (the message line offers Undo), and a map the
// user gave that read (it is kept as a preset, once the tab is shown).
export interface AppliedMap {
  preset: string;
  fileName: string;
}
export interface LearnedMap {
  fileName: string;
  signature: TypeSignature;
  types: TypeMap;
}

export interface Resolved {
  structure: Structure;
  // The page's map that was used, kept on the model; a config's map is in the config, so it is not here.
  types?: TypeMap;
  applied?: AppliedMap;
  learned?: LearnedMap;
}

// The map a structure reads with, in order: the dropped config's (it wins), the map the page's form gave, the one saved
// preset that matches, else the form.
export function resolveTypes(
  compiler: StructureReader,
  text: string,
  fileName: string,
  maps: { config: TypeMap | undefined; page: TypeMap | undefined },
  autoMatch: boolean,
): Resolved {
  if (hasEntries(maps.config)) return readWithConfigMap(compiler, text, fileName, maps.config);
  if (maps.page !== undefined) return readWithGivenMap(compiler, text, fileName, maps.page);
  const first = compiler.readStructure(text, { fileName });
  if (first.unresolvedTypes.length === 0) return { structure: first.structure };
  const needs = needsTypes(fileName, first.unresolvedTypes, first.typeSignature);
  return readWithSavedMap(compiler, text, fileName, needs, autoMatch);
}

// The dropped config's map, read strictly, as the compile reads it (its errors are the config's, so the card shows them
// as they are). The config names the types, so the form is not asked.
function readWithConfigMap(compiler: StructureReader, text: string, fileName: string, configTypes: TypeMap): Resolved {
  try {
    return { structure: compiler.readStructure(text, { fileName, configTypes }).structure };
  } catch (error) {
    throw new ConfigFileError(errorText(error));
  }
}

// The map the user gave: read with it, and kept as a preset once the read succeeds.
function readWithGivenMap(compiler: StructureReader, text: string, fileName: string, given: TypeMap): Resolved {
  const needs = needsOfFile(compiler, text, fileName);
  const read = readWithMap(compiler, text, fileName, given, "The type map", needs);
  return { structure: read.structure, types: given, learned: { fileName, signature: needs.signature, types: given } };
}

// The one saved preset that matches, applied when it is informative (a file with no distinguishing masses or labels
// matches too many); anything else asks the form, with the matches as suggestions.
function readWithSavedMap(
  compiler: StructureReader,
  text: string,
  fileName: string,
  needs: TypesNeeded,
  autoMatch: boolean,
): Resolved {
  const matches = needs.suggested;
  if (!autoMatch || matches.length !== 1 || !isInformative(needs.signature)) throw needs;
  const [preset] = matches;
  const types = restrictMap(preset.types, needs.unresolved);
  const label = `The saved type map "${preset.name}"`;
  const read = readWithMap(compiler, text, fileName, types, label, needs);
  return { structure: read.structure, types, applied: { preset: preset.name, fileName } };
}

// The file read with a map. A map the reader refuses, or that leaves types unresolved, is a TypeMapRejected carrying
// what the form asks for.
function readWithMap(
  compiler: StructureReader,
  text: string,
  fileName: string,
  types: TypeMap,
  label: string,
  needs: TypesNeeded,
): ReadStructureResult {
  let read: ReadStructureResult;
  try {
    read = compiler.readStructure(text, { fileName, pageTypes: types });
  } catch (error) {
    throw new TypeMapRejected(needs, `${label} did not read: ${errorText(error)}`);
  }
  if (read.unresolvedTypes.length > 0) {
    const left = read.unresolvedTypes.join(", ");
    throw new TypeMapRejected(needs, `${label} leaves the types ${left} without an element.`);
  }
  return read;
}

// The file's LAMMPS types, from a read with no map. The file's signature is the one a preset is kept under, so it is
// read from the file as it is, not from a read with a map (whose labels are the map's).
function needsOfFile(compiler: StructureReader, text: string, fileName: string): TypesNeeded {
  const probe = compiler.readStructure(text, { fileName });
  return needsTypes(fileName, probe.unresolvedTypes, probe.typeSignature);
}

function needsTypes(fileName: string, unresolved: number[], signature: TypeSignature | null): TypesNeeded {
  if (signature === null) throw new Error(`${fileName}: cannot resolve the atom types ${unresolved.join(", ")}`);
  return new TypesNeeded(fileName, unresolved, signature, matchingPresets(presetList.peek(), signature));
}
