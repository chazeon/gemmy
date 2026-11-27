// A structure tab's model: what the page keeps of a structure it has read, so that its config can change and the scene is
// compiled again from it. The compile runs in the compiler (compile.js); this module only holds the pieces and
// the signal that says which model the stage shows. `activeModel` is set when a tab is shown (ui/structure-config.ts).
import { type Signal, signal } from "@preact/signals-core";
import type { BondRule, ClusterRule, Color, PolyhedronRule, SceneConfig } from "../compile/config";
import { pairOf } from "../compile/config-edit-bonds";
import { ringKeyOf } from "../compile/config-edit-clusters";
import type { FileSource } from "../compile/files";
import type { Compiler } from "../scene/compiler";
import type { NeighborSource, Structure } from "../structure/structure";
import type { TypeMap } from "../structure/types";
import type { Scene } from "../types";

export interface StructureModel {
  fileName: string;
  structure: Structure;
  neighbors: NeighborSource;
  files: FileSource;
  config: Signal<SceneConfig>;
  // The LAMMPS type map the structure was read with, when it had one.
  types: TypeMap | undefined;
  compiler: Compiler;
}

// The model the stage shows (null for a scene, the start screen, or a tab not yet loaded).
export const activeModel = signal<StructureModel | null>(null);

// The scene the model compiles to with its current config. The warnings the stages raise go into `warnings`.
export function compileModel(model: StructureModel, warnings?: string[]): Scene {
  return model.compiler.compileScene(model.structure, model.neighbors, model.config.peek(), model.files, warnings);
}

// The label pairs detection owns, per model: one automatic rule per pair (config-edit-bonds.ts pairOf). Page-only: a config
// has no field for ownership, so it stays Python-valid. A pair leaves the set when the panel edits its rule.
const automaticBonds = new WeakMap<StructureModel, Set<string>>();
// The centre labels detection owns, per model: one automatic polyhedron per centre. Page-only, as the bonds' set is.
const automaticPolyhedra = new WeakMap<StructureModel, Set<string>>();
// The ring patterns detection owns, per model: one automatic ring per pattern (config-edit-clusters.ts ringKeyOf). Page-only too.
const automaticRings = new WeakMap<StructureModel, Set<string>>();
// The labels whose colour is the scheme's, per model: the colour a structure opened alone gave them. A colour the user
// sets leaves the set; a colour scheme change recolours the labels still in it (ui/colour-switch.ts). Page-only too.
const automaticColours = new WeakMap<StructureModel, Set<string>>();

// The set of a model in a store, made empty on first use.
function ownedIn(store: WeakMap<StructureModel, Set<string>>, model: StructureModel | null): Set<string> {
  if (model === null) return new Set();
  let identities = store.get(model);
  if (identities === undefined) {
    identities = new Set();
    store.set(model, identities);
  }
  return identities;
}

export function automaticBondsOf(model: StructureModel | null): Set<string> {
  return ownedIn(automaticBonds, model);
}

export function automaticPolyhedraOf(model: StructureModel | null): Set<string> {
  return ownedIn(automaticPolyhedra, model);
}

export function automaticRingsOf(model: StructureModel | null): Set<string> {
  return ownedIn(automaticRings, model);
}

export function automaticColoursOf(model: StructureModel | null): Set<string> {
  return ownedIn(automaticColours, model);
}

// What detection gave each rule it made, by identity: the defaults the panel's reset dots return a field to. An edit ends a
// rule's automatic status but not its default, so an edited rule can still be reset; a re-detect or a clear replaces or
// removes the entries of the rules it owns, and removing a rule removes its entry.
export interface DetectedValues {
  radius?: number;
  // A ring's member counts, min_size and max_size (null: no limit).
  sizes?: [number, number | null];
  color: Color;
}
const detectedValues = new WeakMap<StructureModel, Map<string, DetectedValues>>();

export function detectedValuesOf(model: StructureModel | null): Map<string, DetectedValues> {
  if (model === null) return new Map();
  let values = detectedValues.get(model);
  if (values === undefined) {
    values = new Map();
    detectedValues.set(model, values);
  }
  return values;
}

// The identities a default is keyed by: a bond's pair, a polyhedron's centre, a ring's pattern (prefixed by kind).
export const bondDefaultKey = (pair: string) => `bond ${pair}`;
export const polyhedronDefaultKey = (centre: string) => `polyhedron ${centre}`;
export const ringDefaultKey = (pattern: string) => `ring ${pattern}`;

// Records the rules a model was given by detection (its default config's bonds).
export function markAutomaticBonds(model: StructureModel, rules: readonly BondRule[]): void {
  const identities = automaticBondsOf(model);
  const values = detectedValuesOf(model);
  for (const rule of rules) {
    identities.add(pairOf(rule));
    values.set(bondDefaultKey(pairOf(rule)), { radius: rule.radius, color: rule.color });
  }
}

// Records the polyhedra a model was given by detection (its default config's polyhedra), by centre label.
export function markAutomaticPolyhedra(model: StructureModel, rules: readonly PolyhedronRule[]): void {
  const centres = automaticPolyhedraOf(model);
  const values = detectedValuesOf(model);
  for (const rule of rules) {
    centres.add(rule.center);
    values.set(polyhedronDefaultKey(rule.center), { color: rule.color });
  }
}

// Records the labels a model was given a scheme's colour for (its default config's elements, keyed by label).
export function markAutomaticColours(model: StructureModel, labels: readonly string[]): void {
  const colours = automaticColoursOf(model);
  for (const label of labels) colours.add(label);
}

// Records the ring patterns a model was given by detection (its default config's ring clusters).
export function markAutomaticRings(model: StructureModel, rules: readonly ClusterRule[]): void {
  const patterns = automaticRingsOf(model);
  const values = detectedValuesOf(model);
  for (const rule of rules) {
    if (rule.kind !== "ring") continue;
    patterns.add(ringKeyOf(rule));
    values.set(ringDefaultKey(ringKeyOf(rule)), { color: rule.color, sizes: [rule.min_size, rule.max_size] });
  }
}
