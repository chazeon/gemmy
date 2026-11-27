// The switch of the element colour scheme on a model: the elements still holding their scheme colour, and the automatic
// polyhedra and rings (their colour is their centre's, as detection gives it), take the new scheme's colours. A colour the
// user set by hand is kept. The scheme choice itself is ui/colour-scheme.ts.
import { type ColourScheme, type ColourSchemeChoice, elementTableOf } from "../compile/colour-schemes";
import type { ClusterRule, Color, PolyhedronRule, SceneConfig } from "../compile/config";
import { ringKeyOf } from "../compile/config-edit-clusters";
import { defaultShapesOf } from "../compile/default-kind";
import { schemeFor } from "../compile/structure-kind";
import { elementOfLabel } from "../structure/elements";
import { chooseColourScheme } from "./colour-scheme";
import { automaticColoursOf, automaticPolyhedraOf, automaticRingsOf, type StructureModel } from "./structure-model";

// The config's element styles with the automatic labels given the scheme's colour. A label is the key of its style; its
// colour comes from the table of its element (elementOfLabel: C_dna takes carbon's). A label the user coloured is not in
// `automatic`, so it keeps its colour; a label whose element the table lacks keeps its style too.
export function recolouredElements(
  elements: SceneConfig["elements"],
  automatic: ReadonlySet<string>,
  scheme: ColourScheme,
): SceneConfig["elements"] {
  const table = elementTableOf(scheme);
  const recoloured = { ...elements };
  for (const label of automatic) {
    const element = elementOfLabel(label);
    if (Object.hasOwn(recoloured, label) && element !== undefined && Object.hasOwn(table, element)) {
      recoloured[label] = { ...recoloured[label], color: table[element].color };
    }
  }
  return recoloured;
}

// The automatic polyhedra and rings of a config, with the colours detection gives them under the scheme. Only the owned
// ones change (by centre label, or by ring pattern); their windows and atoms stay as they are.
export function recolouredRules(
  config: SceneConfig,
  owned: { centres: ReadonlySet<string>; rings: ReadonlySet<string> },
  detected: { polyhedra: PolyhedronRule[]; rings: ClusterRule[] },
): SceneConfig {
  const polyhedronColour = new Map<string, Color>(detected.polyhedra.map((rule) => [rule.center, rule.color]));
  const ringColour = new Map<string, Color>(detected.rings.map((rule) => [ringKeyOf(rule), rule.color]));
  return {
    ...config,
    polyhedra: config.polyhedra.map((rule) => {
      const color = polyhedronColour.get(rule.center);
      return owned.centres.has(rule.center) && color !== undefined ? { ...rule, color } : rule;
    }),
    clusters: config.clusters.map((rule) => {
      const color = ringColour.get(ringKeyOf(rule));
      return owned.rings.has(ringKeyOf(rule)) && color !== undefined ? { ...rule, color } : rule;
    }),
  };
}

// The config a scheme gives a model: its automatic elements, polyhedra and rings recoloured. Detection reads the recoloured
// elements, so a centre's colour is the one the scheme gives it. With no model (no structure shown) there is nothing to
// recolour.
export function recolouredModel(
  model: StructureModel | null,
  config: SceneConfig,
  choice: ColourSchemeChoice,
): SceneConfig {
  if (model === null) return config;
  const scheme = schemeFor(model.structure, choice);
  const elements = recolouredElements(config.elements, automaticColoursOf(model), scheme);
  const recoloured = { ...config, elements };
  const detected = defaultShapesOf(model.structure, model.neighbors, elements, scheme);
  const owned = { centres: automaticPolyhedraOf(model), rings: automaticRingsOf(model) };
  return recolouredRules(recoloured, owned, detected);
}

// The Atoms list's change: the config recoloured for the scheme, and the scheme kept for the next structure and visit.
export function switchColourScheme(
  model: StructureModel | null,
  config: SceneConfig,
  choice: ColourSchemeChoice,
): SceneConfig {
  const next = recolouredModel(model, config, choice);
  chooseColourScheme(choice);
  return next;
}
