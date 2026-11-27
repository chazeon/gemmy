// The element colour schemes the page offers. The schemes are the registry's (compile/schemes/registry.ts: one JSON file
// each, listed there in dropdown order); the radii every scheme shares are element-styles.json (scripts/gen_element_styles.py).
// A structure opened alone takes its elements' styles from the scheme chosen in the page (ui/colour-scheme.ts): defaultConfig,
// and the detection of polyhedra and rings, read the scheme they are given, so the compiler keeps no page state.
import { type Color, type SceneConfig, defaultElementStyle } from "./config";
import elementStyleFile from "./element-styles.json";
import { SCHEMES, type SchemeFile } from "./schemes/registry";

// A scheme is named by its id (its file's "id"). The table of ids is the registry; no code outside it names a scheme.
export type ColourScheme = string;

// The choices the page offers: Auto, which gives each structure the scheme of its kind (structure-kind.ts), or one scheme
// for every structure. Auto is the default.
export type ColourSchemeChoice = "auto" | ColourScheme;
export const DEFAULT_COLOUR_SCHEME_CHOICE: ColourSchemeChoice = "auto";

// The options the dropdown lists, in order: Auto, then every registered scheme by its name.
export const COLOUR_SCHEME_OPTIONS: readonly { value: ColourSchemeChoice; text: string }[] = [
  { value: "auto", text: "Auto" },
  ...SCHEMES.map((scheme) => ({ value: scheme.id, text: scheme.name })),
];

// An element's default style under a scheme: its colour and its sphere radius (the config's element fields, before the
// schema fills the rest). The table is keyed by element; the config's element styles are keyed by label.
export interface ElementEntry {
  color: Color;
  radius: number;
}

const radii: Record<string, number> = elementStyleFile.radii;

// A file's colour, "#rrggbb", as the config's colour: four channels in 0-1, opaque.
function colorOf(hex: string): Color {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`colour ${hex} is not #rrggbb`);
  const [red, green, blue] = match.slice(1).map((pair) => Number.parseInt(pair, 16) / 255);
  return [red, green, blue, 1];
}

function tableOf(scheme: SchemeFile): Record<string, ElementEntry> {
  return Object.fromEntries(
    Object.entries(scheme.colours).map(([symbol, hex]) => {
      if (!Object.hasOwn(radii, symbol))
        throw new Error(`colour scheme ${scheme.id} has ${symbol}, which has no radius`);
      return [symbol, { color: colorOf(hex), radius: radii[symbol] }];
    }),
  );
}

const tables = new Map<ColourScheme, Record<string, ElementEntry>>();
for (const scheme of SCHEMES) {
  if (scheme.id === DEFAULT_COLOUR_SCHEME_CHOICE || tables.has(scheme.id)) {
    throw new Error(`colour scheme id ${scheme.id} is used twice, or is the Auto choice`);
  }
  tables.set(scheme.id, tableOf(scheme));
}

// The default style of each element under a scheme, keyed by symbol (the table has every element it colours).
export function elementTableOf(scheme: ColourScheme): Record<string, ElementEntry> {
  const table = tables.get(scheme);
  if (table === undefined) throw new Error(`no colour scheme ${scheme}`);
  return table;
}

// The key of the element styles' fallback entry: the style of an element with no entry of its own.
export const DEFAULT_ELEMENT_KEY = "default";

// The colour a centre's atoms are drawn with, for a centre with this label and element: the config's own style for the
// label when it sets one, else the colour the scheme gives the element, else the style of the DEFAULT_ELEMENT_KEY entry
// (the grey of a dummy atom), else the built-in default. An automatic polyhedron takes this colour when it is detected,
// and keeps it until Re-detect: a later change to the element's colour does not recolour it.
export function centreColourOf(
  elements: SceneConfig["elements"],
  label: string,
  element: string,
  scheme: ColourScheme,
): Color {
  if (Object.hasOwn(elements, label)) return elements[label].color;
  const table = elementTableOf(scheme);
  if (Object.hasOwn(table, element)) return table[element].color;
  return Object.hasOwn(elements, DEFAULT_ELEMENT_KEY)
    ? elements[DEFAULT_ELEMENT_KEY].color
    : defaultElementStyle().color;
}

// Whether a value names a choice: Auto, or a registered scheme's id. A stored value that names neither is not a choice.
export function isColourSchemeChoice(value: unknown): value is ColourSchemeChoice {
  return COLOUR_SCHEME_OPTIONS.some((option) => option.value === value);
}
