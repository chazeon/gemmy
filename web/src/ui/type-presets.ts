// The LAMMPS type maps the user has given, kept as presets. A preset is a name, the map and the file's
// type signature (structure/types.ts), so a later file of the same project matches it and gets the map with no question.
// A preset is named by presetKey, never by its place in a list, so a row being renamed does not pick another one. This
// module is pure (the node tests run it): the file format is type-presets-file.ts, and the page's list and its storage
// are type-preset-store.ts.
import type { TypeMap, TypeSignature } from "../structure/types";

export interface TypePreset {
  name: string;
  types: TypeMap;
  signature: TypeSignature;
}

// A preset's identity: its name, its signature and its map. Two presets with one key are the same preset.
export function presetKey(preset: TypePreset): string {
  const types = Object.keys(preset.types)
    .map(Number)
    .sort((a, b) => a - b)
    .map((type) => [type, preset.types[type]]);
  return JSON.stringify([preset.name, preset.signature, types]);
}

// Two lists with the same items in the same order. A null list matches only a null one.
function sameList<T>(a: readonly T[] | null, b: readonly T[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((item, k) => item === b[k]);
}

export function sameSignature(a: TypeSignature, b: TypeSignature): boolean {
  return sameList(a.types, b.types) && sameList(a.masses, b.masses) && sameList(a.labels, b.labels);
}

// The presets whose signature is this file's, in the order kept.
export function matchingPresets(presets: readonly TypePreset[], signature: TypeSignature): TypePreset[] {
  return presets.filter((preset) => sameSignature(preset.signature, signature));
}

// The presets with each key once, the first kept for a key, in order.
export function uniquePresets(presets: readonly TypePreset[]): TypePreset[] {
  const byKey = new Map<string, TypePreset>();
  for (const preset of presets) {
    const key = presetKey(preset);
    if (!byKey.has(key)) byKey.set(key, preset);
  }
  return [...byKey.values()];
}

export function addPreset(presets: readonly TypePreset[], preset: TypePreset): TypePreset[] {
  return uniquePresets([...presets, preset]);
}

// The presets of a shared file, added to the ones kept (a preset already kept is not added twice).
export function mergePresets(presets: readonly TypePreset[], incoming: readonly TypePreset[]): TypePreset[] {
  return uniquePresets([...presets, ...incoming]);
}

// The presets with the one at `key` renamed (a blank name is refused by the row, not here). A rename that makes it equal
// to a preset kept already leaves one of them.
export function renamePreset(presets: readonly TypePreset[], key: string, name: string): TypePreset[] {
  return uniquePresets(presets.map((preset) => (presetKey(preset) === key ? { ...preset, name } : preset)));
}

export function deletePreset(presets: readonly TypePreset[], key: string): TypePreset[] {
  return presets.filter((preset) => presetKey(preset) !== key);
}
