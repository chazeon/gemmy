// The presets file's format: a format tag, a version and the presets, as JSON. The browser keeps its copy in this same
// format (type-preset-store.ts), and a shared file is this format too.
//
// Version 2 is the first with type ids in the signature. A version 1 signature held a count, which cannot match a file's
// ids, so version 1 is not upgraded: a shared version 1 file is refused with its version, and the browser's version 1
// copy is dropped on read (its presets are lost; they can be made again by applying the map).
import { isElementLabel } from "../structure/elements";
import type { TypeMap, TypeSignature } from "../structure/types";
import { type TypePreset, uniquePresets } from "./type-presets";

const FORMAT = "gemmy-type-presets";
const VERSION = 2;

export const PRESETS_FILENAME = "gemmy-type-presets.json";

// The limits on what a presets file may hold. A file is read whole, so its size is checked before it is read.
export const MAX_PRESETS_FILE_BYTES = 256 * 1024;
export const MAX_PRESETS = 200;

export class TypePresetError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The JSON value of a text, or undefined when it is not JSON (JSON has no undefined, so no value is confused with it).
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isPreset = (preset: TypePreset | null): preset is TypePreset => preset !== null;

// A type id is a safe integer from 1 up: LAMMPS numbers its types from 1.
const isTypeId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isLabelOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.trim() !== "");

// The ids of a signature: a non-empty list of type ids in ascending order, with no repeats.
function isTypeIdList(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isTypeId)) return false;
  return value.every((id, k) => k === 0 || id > value[k - 1]);
}

// A per-type list of a signature (masses or labels): null when the file has none, else one item per type.
function isPerTypeList<T>(value: unknown, count: number, isItem: (item: unknown) => item is T): value is T[] | null {
  return value === null || (Array.isArray(value) && value.length === count && value.every(isItem));
}

function signatureOf(value: unknown): TypeSignature | null {
  if (!isRecord(value) || !isTypeIdList(value.types)) return null;
  const types = value.types;
  if (!isPerTypeList(value.masses, types.length, isFiniteNumber)) return null;
  if (!isPerTypeList(value.labels, types.length, isLabelOrNull)) return null;
  return { types, masses: value.masses, labels: value.labels };
}

// The type ids a map's keys name. Only the canonical spelling is one: "1" and "01" are not both type 1.
const CANONICAL_TYPE_ID = /^[1-9]\d*$/;
function typeIdOfKey(key: string): number | null {
  if (!CANONICAL_TYPE_ID.test(key)) return null;
  const id = Number(key);
  return Number.isSafeInteger(id) ? id : null;
}

// A type map: each key a canonical type id, each label a name of an element (the rule fastatoms reads labels by).
function typeMapOf(value: unknown): TypeMap | null {
  if (!isRecord(value)) return null;
  const map: Record<number, string> = {};
  for (const [key, label] of Object.entries(value)) {
    const type = typeIdOfKey(key);
    if (type === null || typeof label !== "string" || !isElementLabel(label)) return null;
    map[type] = label;
  }
  return map;
}

// One preset from its JSON value, or null when it is not a valid one.
function presetOf(value: unknown): TypePreset | null {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "") return null;
  const types = typeMapOf(value.types);
  const signature = signatureOf(value.signature);
  return types === null || signature === null ? null : { name: value.name, types, signature };
}

// The presets of a presets file's value, or the reason the value is not one (its format, its version, its size).
function envelopeOf(value: unknown): { presets: unknown[] } | { problem: string } {
  if (!isRecord(value) || value.format !== FORMAT || !Array.isArray(value.presets)) {
    return { problem: `The file is not a gemmy type presets file (it has no "${FORMAT}" format).` };
  }
  if (value.version !== VERSION) {
    return { problem: `The presets file has version ${String(value.version)}; this viewer reads version ${VERSION}.` };
  }
  if (value.presets.length > MAX_PRESETS) {
    return { problem: `The presets file has more than ${MAX_PRESETS} presets.` };
  }
  return { presets: value.presets };
}

// A presets file (shared, or downloaded): its presets with each key once. A file that is not one, or holds a damaged
// preset, is refused whole, with the reason.
export function presetsFromFile(text: string): TypePreset[] {
  const value = parseJson(text);
  if (value === undefined) throw new TypePresetError("The file is not valid JSON, so it is not a presets file.");
  const envelope = envelopeOf(value);
  if ("problem" in envelope) throw new TypePresetError(envelope.problem);
  const presets = envelope.presets.map(presetOf);
  if (!presets.every(isPreset)) throw new TypePresetError("A preset in the file is not a valid type map.");
  return uniquePresets(presets);
}

// The browser's copy, read: its valid presets. A text that is not this format and version gives none, and a damaged
// preset is dropped while the rest are kept (a shared file is refused whole instead: presetsFromFile).
export function presetsFromStored(text: string): TypePreset[] {
  const envelope = envelopeOf(parseJson(text));
  if ("problem" in envelope) return [];
  return uniquePresets(envelope.presets.map(presetOf).filter(isPreset));
}

// The text of a presets file for these presets.
export function presetsToFile(presets: readonly TypePreset[]): string {
  return `${JSON.stringify({ format: FORMAT, version: VERSION, presets }, null, 2)}\n`;
}
