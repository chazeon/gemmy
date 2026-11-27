// The style item a picked object uses: the section that styles it, and the folder's key (its title). An atom is styled by
// its label's folder in Atoms; a bond by the first rule of its label pair whose window covers its length; a polyhedron by
// the rule of its centre's label. Pure: the dock reads the readout and the config and nothing else.
import type { BondRule, SceneConfig } from "../../compile/config";
import { pairOf } from "../../compile/config-edit-bonds";
import type { Readout } from "../../ui/readout";
import { pairName } from "../../ui/style-panel-model";
import { polyhedronFolderTitle } from "./shapes-nodes";

export interface StyleTarget {
  section: "atoms" | "bonds" | "shapes";
  key: string;
}

export function styleTargetOf(selection: Readout, config: SceneConfig): StyleTarget | null {
  switch (selection.kind) {
    case "atom":
      return { section: "atoms", key: selection.label };
    case "bond":
      return bondTarget(selection, config);
    case "polyhedron":
      return polyhedronTarget(selection, config);
    case "none":
      return null;
  }
}

function bondTarget(selection: Extract<Readout, { kind: "bond" }>, config: SceneConfig): StyleTarget | null {
  const [first, second] = selection.ends.map((end) => end.label);
  const length = Number(selection.length);
  const pair = pairOf({ a: first, b: second });
  const rule = config.bonds.find((candidate) => pairOf(candidate) === pair && coversLength(candidate, length));
  return rule === undefined ? null : { section: "bonds", key: pairName(rule.a, rule.b) };
}

// A rule covers a length when the length lies in its window.
function coversLength(rule: Pick<BondRule, "min_distance" | "max_distance">, length: number): boolean {
  return rule.min_distance <= length && length <= rule.max_distance;
}

function polyhedronTarget(
  selection: Extract<Readout, { kind: "polyhedron" }>,
  config: SceneConfig,
): StyleTarget | null {
  const centre = centreLabelOf(selection);
  const rule = config.polyhedra.find((candidate) => candidate.center === centre);
  if (rule === undefined) return null;
  return { section: "shapes", key: polyhedronFolderTitle(rule) };
}

// The label of a polyhedron's centre. The readout writes the centre as "Si at (0.1, 0.2, 0.3)" (ui/readout.ts,
// centreText), so the label is the text before " at (". A computed centre reads "centroid", which names no label and finds no rule.
function centreLabelOf(selection: Extract<Readout, { kind: "polyhedron" }>): string {
  return selection.centre.split(" at (")[0];
}
