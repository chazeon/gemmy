// The colour scheme choice the page uses: Auto (the default: each structure takes the scheme of its kind, structure-kind.ts),
// or one registered scheme (compile/schemes/) for every structure. It is kept per browser under COLOUR_SCHEME_KEY, as the
// outline width is (outline-scale.ts), and a stored id that no longer names a scheme reads as Auto. A structure opened alone
// is given the scheme's colours (ui/structure-load.ts). The switch itself, which recolours the model, is in
// ui/colour-switch.ts; this module imports no detection, so the structure loader can read the choice without it.
import { signal } from "@preact/signals-core";
import { type ColourSchemeChoice, DEFAULT_COLOUR_SCHEME_CHOICE, isColourSchemeChoice } from "../compile/colour-schemes";
import { remembered } from "./storage";

const COLOUR_SCHEME_KEY = "gemmy.colour-scheme";

// The choice a stored value gives: Auto for anything that names no choice, so a scheme removed from the registry (or a
// value from another page) falls back to Auto.
export function storedChoice(raw: string | null): ColourSchemeChoice {
  return isColourSchemeChoice(raw) ? raw : DEFAULT_COLOUR_SCHEME_CHOICE;
}

const stored = remembered<ColourSchemeChoice>(COLOUR_SCHEME_KEY, storedChoice);
// The choice in use: the Atoms list shows it, and a structure opened alone takes its colours from it (resolved per structure).
export const colourScheme = signal(stored.read());

// The choice is kept for the next visit.
export function chooseColourScheme(choice: ColourSchemeChoice): void {
  colourScheme.value = choice;
  stored.write(choice);
}
