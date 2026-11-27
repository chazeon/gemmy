// The LAMMPS type map flow of a structure tab: the card's form when the file's types have no element, its Apply (the map
// is cut to the unresolved types and the tab is loaded again with it) and Cancel, the note for a saved map that was used
// (with Undo, which turns automatic matching off for that tab). It is written against the narrow tab shape and the host
// that reloads a tab, so the loader (ui/loader.ts) passes its tabs in and this module does not import it.
import { hasTypes, type Source } from "../scene/source";
import { type TypeMap, restrictMap } from "../structure/types";
import type { Attempt } from "./attempts";
import { askTypes, fail } from "./home";
import type { AppliedMap } from "./type-resolution";
import { note } from "./message";
import type { TypesNeeded } from "./types-needed";

export interface MapTab {
  source: Source;
  // Undo was used on this tab: its next load asks for the map rather than applying a saved one.
  autoMatchOff: boolean;
}

export interface MapHost<T extends MapTab> {
  // Loads the tab again, with its source as it now is.
  reload(tab: T): void;
}

// What the form shows with the prompt: the user's draft and why the map did not read.
export interface MapProblem {
  error: string;
  draft?: TypeMap;
}

// The card asks for a structure's types. The prompt belongs to `attempt`: once that attempt is no longer current (the
// selection or the load changed), Apply and Cancel do nothing.
export function askForTypes<T extends MapTab>(
  tab: T,
  needs: TypesNeeded,
  attempt: Attempt,
  host: MapHost<T>,
  problem?: MapProblem,
): void {
  askTypes({
    fileName: needs.fileName,
    unresolved: needs.unresolved,
    suggested: needs.suggested,
    draft: problem?.draft,
    error: problem?.error,
    apply: (map) => {
      if (attempt.current()) applyTypes(tab, needs, map, host);
    },
    cancel: () => {
      if (attempt.current()) fail(`${needs.fileName} was not opened: its LAMMPS types have no element.`);
    },
  });
}

function applyTypes<T extends MapTab>(tab: T, needs: TypesNeeded, map: TypeMap, host: MapHost<T>): void {
  if (!hasTypes(tab.source)) return;
  tab.source = { ...tab.source, types: restrictMap(map, needs.unresolved) };
  host.reload(tab);
}

// A saved map was used for the file: the message line says so, and Undo asks for the map again.
export function showAppliedMap<T extends MapTab>(tab: T, applied: AppliedMap, host: MapHost<T>): void {
  note(`Used the saved type map "${applied.preset}" for ${applied.fileName}.`, {
    action: { label: "Undo", run: () => undoAppliedMap(tab, host) },
  });
}

export function undoAppliedMap<T extends MapTab>(tab: T, host: MapHost<T>): void {
  if (!hasTypes(tab.source)) return;
  tab.autoMatchOff = true;
  tab.source = { ...tab.source, types: undefined };
  host.reload(tab);
}
