// Loading a structure tab, in the page: the compiler is loaded; the file and its sidecars are read; the LAMMPS types are
// resolved (type-resolution.ts); the config is picked and read (a dropped config, else the defaults); the atoms are
// budgeted, the neighbour source is made, and the scene is compiled. A load that is no longer current stops before its
// next read or compile (ui/attempts.ts). The compiler's errors are the messages, named by the file or config they came
// from.
import { signal } from "@preact/signals-core";
import type { SceneConfig } from "../compile/config";
import type { SidecarFile } from "../compile/files";
import { errorText } from "../errors";
import { type Compiler, compilerMeta, loadCompiler } from "../scene/compiler";
import { MAX_FILE_BYTES, fileText, readCapped, unzippedName } from "../scene/read";
import type { Source } from "../scene/source";
import type { Scene } from "../types";
import { type Attempt, stopIfStale } from "./attempts";
import { schemeFor } from "../compile/structure-kind";
import { colourScheme } from "./colour-scheme";
import { atomBudgetProblem, baseAtomBudgetProblem, MAX_SIDECAR_BYTES, sidecarBudgetProblem } from "./load-budgets";
import {
  compileModel,
  markAutomaticBonds,
  markAutomaticColours,
  markAutomaticPolyhedra,
  markAutomaticRings,
  type StructureModel,
} from "./structure-model";
import { type AppliedMap, type LearnedMap, type Resolved, resolveTypes } from "./type-resolution";
import { ConfigFileError } from "./types-needed";

export type StructureSource = Extract<Source, { kind: "structure" }>;

// What a structure load yields: the scene, its model, and what the page says about the types it used.
export interface StructureLoaded {
  doc: Scene;
  name: string;
  model: StructureModel;
  warnings: string[];
  applied?: AppliedMap;
  learned?: LearnedMap;
}

// What a structure file the page cannot compile says on the card (a single-file page has no compiler).
export const ONE_FILE_MESSAGE =
  "This page is one self-contained file and cannot compile structures. Run gemmy compile, or open the hosted viewer or gemmy serve.";

// A structure source loaded for `attempt`. Throws TypesNeeded when the card must ask for the types, TypeMapRejected when
// a map did not read, and LoadStopped when the attempt is no longer current.
export async function loadStructure(
  source: StructureSource,
  attempt: Attempt,
  autoMatch: boolean,
): Promise<StructureLoaded> {
  if (compilerMeta() === null) throw new Error(ONE_FILE_MESSAGE);
  const compiler = await loadCompiler();
  stopIfStale(attempt);
  const fileName = source.file.name;
  const text = await textFromFile(source.file, MAX_FILE_BYTES);
  stopIfStale(attempt);
  const sidecars = await readSidecars(source.sidecars);
  stopIfStale(attempt);
  refuseSceneSidecars(compiler, sidecars, fileName);
  const dropped = droppedConfig(compiler, sidecars, fileName);
  const resolved = resolveTypes(compiler, text, fileName, { config: dropped?.types, page: source.types }, autoMatch);
  return finishStructure(compiler, fileName, resolved, dropped, sidecars);
}

// The rest, once the types are resolved. Synchronous, so the caller's one check before it covers the native work here.
function finishStructure(
  compiler: Compiler,
  fileName: string,
  resolved: Resolved,
  dropped: SceneConfig | null,
  sidecars: readonly SidecarFile[],
): StructureLoaded {
  // The base structure is budgeted before the defaults derive their bonds, which search the structure's unit cell.
  const base = baseAtomBudgetProblem(fileName, resolved.structure.atoms.length);
  if (base !== null) throw new Error(base);
  // The config the structure compiles with: the dropped one, else the defaults with the structure filled in and its bonds
  // derived from it.
  const config =
    dropped ?? compiler.defaultConfig(fileName, resolved.structure, schemeFor(resolved.structure, colourScheme.peek()));
  const problem = atomBudgetProblem(fileName, resolved.structure.atoms.length, config.cell.supercell);
  if (problem !== null) throw new Error(problem);
  const neighbors = compiler.neighborSource(resolved.structure, config.cell.supercell, config.cell.periodic);
  const model: StructureModel = {
    fileName,
    structure: resolved.structure,
    neighbors,
    files: compiler.fileSource(sidecars),
    config: signal(config),
    types: resolved.types,
    compiler,
  };
  // The default bonds, polyhedra and rings are detected, so the panel marks them automatic (a dropped config's are the
  // user's).
  if (dropped === null) {
    markAutomaticBonds(model, config.bonds);
    markAutomaticPolyhedra(model, config.polyhedra);
    markAutomaticRings(model, config.clusters);
    markAutomaticColours(model, Object.keys(config.elements));
  }
  const warnings: string[] = [];
  const doc = compileModel(model, warnings);
  return { doc, name: fileName, model, warnings, applied: resolved.applied, learned: resolved.learned };
}

// The sidecars, read under their budget. A gzipped sidecar takes the name it has once gunzipped (scene.json.gz is
// scene.json), so the compile classifies it as the file it holds.
async function readSidecars(files: readonly File[]): Promise<SidecarFile[]> {
  const problem = sidecarBudgetProblem(files.map((file) => file.size));
  if (problem !== null) throw new Error(problem);
  return Promise.all(
    files.map(async (file) => ({
      name: unzippedName(file.name),
      text: await textFromFile(file, MAX_SIDECAR_BYTES),
    })),
  );
}

// A file's text, read in the page: capped while it streams, and gunzipped when it is gzip.
async function textFromFile(file: File, limit: number): Promise<string> {
  return fileText(await readCapped(file.stream(), file.name, limit), limit);
}

// A scene given as a sidecar is opened on its own, not with the structure.
function refuseSceneSidecars(compiler: Compiler, sidecars: readonly SidecarFile[], fileName: string): void {
  for (const sidecar of sidecars) {
    if (compiler.sidecarKind(sidecar.name, sidecar.text) === "scene") {
      throw new Error(`${sidecar.name} is a scene file: open it on its own, not with ${fileName}.`);
    }
  }
}

// The dropped config, read; null when no config was dropped. A config's error is named by the config's file.
function droppedConfig(compiler: Compiler, sidecars: readonly SidecarFile[], fileName: string): SceneConfig | null {
  const picked = compiler.pickConfig(sidecars, fileName);
  if (picked === null) return null;
  try {
    return compiler.loadSceneConfig(picked.name, picked.text);
  } catch (error) {
    throw new ConfigFileError(namedMessage(picked.name, error));
  }
}

// An error's text, named by the file it came from. A message that already starts with the name (a data file's own
// error does) is kept as it is.
export function namedMessage(name: string, error: unknown): string {
  const message = errorText(error);
  return message.startsWith(name) ? message : `${name}: ${message}`;
}
