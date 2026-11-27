// The Atoms section: one folder per element (its show eye, its colour and its radius), and the colour scheme row above them.
import { COLOUR_SCHEME_OPTIONS, type ColourSchemeChoice, type ElementEntry } from "../../compile/colour-schemes";
import type { SceneConfig } from "../../compile/config";
import { setElementColor, setElementRadius, setElementVisible } from "../../compile/config-edit-elements";
import { ATOM_RADIUS_RANGE, type Apply, RADIUS_STEP, elementStyleOf } from "../../ui/style-panel-model";
import type { Choice, PaneNode } from "./pane-model";
import { choiceValue, colorOf, endingAutomatic, fixed, numberRange, rgbaOf } from "./node-helpers";

function atomSummary(style: { radius: number }): string {
  return `${fixed(style.radius)} Å`;
}

// The Atoms section's colours: the scheme in use, the elements still holding their scheme colour (`automatic`, which a
// hand-set colour removes), and the change of scheme, which returns the config recoloured. `defaultOf` is the scheme's style
// of a label's element (null when the structure has none for it): the defaults the reset dots return to.
export interface AtomColours {
  scheme: ColourSchemeChoice;
  automatic: Set<string>;
  change(next: ColourSchemeChoice): SceneConfig;
  defaultOf(name: string): ElementEntry | null;
}

// Auto, then every registered scheme (compile/colour-schemes.ts), in the registry's order.
const SCHEME_CHOICES: Choice<ColourSchemeChoice>[] = [...COLOUR_SCHEME_OPTIONS];

export function atomsNodes(
  config: SceneConfig,
  names: readonly string[],
  apply: Apply,
  colours: AtomColours,
): PaneNode[] {
  const scheme: PaneNode = {
    kind: "list",
    label: "Colour scheme",
    value: colours.scheme,
    options: SCHEME_CHOICES,
    commit: (next) => apply(() => colours.change(choiceValue(SCHEME_CHOICES, next))),
  };
  const atoms = names.map((name): PaneNode => {
    const style = elementStyleOf(config, name);
    // A colour the user sets is theirs: the element leaves the set the scheme recolours.
    const recolour = endingAutomatic(apply, colours.automatic, name);
    const fallback = colours.defaultOf(name);
    return {
      kind: "folder",
      title: name,
      summary: atomSummary(style),
      swatch: { rgba: rgbaOf(style.color), dim: !style.visible },
      visible: { value: style.visible, commit: (visible) => apply(() => setElementVisible(config, name, visible)) },
      expanded: false,
      children: [
        {
          kind: "color",
          label: "Colour",
          alpha: true,
          value: rgbaOf(style.color),
          default: fallback ? rgbaOf(fallback.color) : undefined,
          commit: (rgba) => recolour(() => setElementColor(config, name, colorOf(rgba))),
        },
        {
          kind: "number",
          label: "Radius",
          value: style.radius,
          ...numberRange(ATOM_RADIUS_RANGE, RADIUS_STEP),
          default: fallback?.radius,
          commit: (radius) => apply(() => setElementRadius(config, name, radius)),
        },
      ],
    };
  });
  return [scheme, ...atoms];
}
