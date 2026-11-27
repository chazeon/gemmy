// What a structure needs from the card before it can open: its LAMMPS type map. TypesNeeded says which types the file
// leaves unresolved and what its signature is (the key a preset is kept under); TypeMapRejected says that a map (the
// user's, or a saved one) did not read, with the reason the card shows. ConfigFileError says that the dropped config did
// not read. TypePrompt is what the card draws (home.ts).
import type { TypeMap, TypeSignature } from "../structure/types";
import type { TypePreset } from "./type-presets";

export class TypesNeeded extends Error {
  constructor(
    readonly fileName: string,
    readonly unresolved: number[],
    readonly signature: TypeSignature,
    readonly suggested: TypePreset[],
  ) {
    super(`${fileName}: the LAMMPS types ${unresolved.join(", ")} have no element; give each one a label`);
  }
}

export class TypeMapRejected extends Error {
  constructor(
    readonly needs: TypesNeeded,
    reason: string,
  ) {
    super(reason);
  }
}

// A config that does not read, or a read whose map is the config's `types` (its errors name the file they come from).
// The card shows the message as it is (no "Could not load <structure>:" in front).
export class ConfigFileError extends Error {}

export interface TypePrompt {
  fileName: string;
  unresolved: number[];
  suggested: TypePreset[];
  // The values the user typed, kept while the form shows an error.
  draft?: Record<number, string>;
  // A message for the form to show while the prompt and its draft stay up.
  error?: string;
  apply(map: TypeMap): void;
  cancel(): void;
}
