// The page's list of type presets: the signal the form draws, kept in localStorage (through ui/storage.ts) in the presets
// file's format (type-presets-file.ts). Importing this module reads the browser's copy once, so the list is ready before
// any caller asks. Every change goes through commit(), which keeps the signal and the copy together.
import { signal } from "@preact/signals-core";
import type { TypeMap, TypeSignature } from "../structure/types";
import { remembered } from "./storage";
import { addPreset, deletePreset, mergePresets, renamePreset, type TypePreset } from "./type-presets";
import {
  MAX_PRESETS,
  MAX_PRESETS_FILE_BYTES,
  PRESETS_FILENAME,
  TypePresetError,
  presetsFromFile,
  presetsFromStored,
  presetsToFile,
} from "./type-presets-file";

const STORAGE_KEY = "gemmy.typePresets";
const KILOBYTE = 1024;
const copy = remembered<string>(STORAGE_KEY, (raw) => raw ?? "");

export const presetList = signal<TypePreset[]>(presetsFromStored(copy.read()));

// Replaces the list and keeps it in the browser. A browser that refuses the write keeps the list for this visit.
function commit(presets: TypePreset[]): void {
  presetList.value = presets;
  copy.write(presetsToFile(presets));
}

// A map the user applied is kept under the file's name, so the next file of its kind gets it. A list at its cap keeps
// what it has (the cap is far above what a project needs).
export function rememberMap(fileName: string, signature: TypeSignature, types: TypeMap): void {
  const next = addPreset(presetList.peek(), { name: fileName, types, signature });
  if (next.length <= MAX_PRESETS) commit(next);
}

export function renameStoredPreset(key: string, name: string): void {
  commit(renamePreset(presetList.peek(), key, name));
}

export function deleteStoredPreset(key: string): void {
  commit(deletePreset(presetList.peek(), key));
}

// A presets file's presets added to the list. A file that is too large, is not a presets file, or would take the list over
// its cap is refused with the reason, and the list stays as it was.
export async function importPresetsFile(file: File): Promise<void> {
  if (file.size > MAX_PRESETS_FILE_BYTES) {
    throw new TypePresetError(
      `The file is larger than ${MAX_PRESETS_FILE_BYTES / KILOBYTE} KB, so it is not a presets file.`,
    );
  }
  const merged = mergePresets(presetList.peek(), presetsFromFile(await file.text()));
  if (merged.length > MAX_PRESETS) {
    throw new TypePresetError(`The presets would be more than ${MAX_PRESETS}. Delete some first.`);
  }
  commit(merged);
}

// Saves the list as a file the user downloads (another browser can import it).
export function downloadPresets(): void {
  const url = URL.createObjectURL(new Blob([presetsToFile(presetList.peek())], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = PRESETS_FILENAME;
  link.click();
  // Revoked on a later turn: a browser may start the download only after click() returns, and a revoke now could cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
