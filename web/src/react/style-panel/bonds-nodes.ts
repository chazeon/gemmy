// The Bonds section: the Detect group, the Add row, and one folder per bond rule.
import type { BondRule, BondStyle, SceneConfig } from "../../compile/config";
import {
  addBondRule,
  clearAutomaticBonds,
  detectedOwnership,
  pairOf,
  removeBondRule,
  replaceAutomaticBonds,
  setBondColor,
  setBondRadius,
  setBondStyle,
  setBondVisible,
  setBondWindow,
} from "../../compile/config-edit-bonds";
import type { DetectionOptions } from "../../compile/default-rules";
import {
  BOND_RADIUS_RANGE,
  type Apply,
  type PairDistances,
  RADIUS_STEP,
  type Span,
  chosenName,
  defaultBondNames,
  firstShellWindow,
  pairDistances,
  pairName,
} from "../../ui/style-panel-model";
import type { Choice, PaneNode } from "./pane-model";
import {
  choiceValue,
  colorOf,
  distanceRange,
  endingAutomatic,
  namesChoices,
  numberRange,
  replaceOwnership,
  rgbaOf,
  windowSummary,
} from "./node-helpers";

export interface BondsInput {
  config: SceneConfig;
  names: readonly string[];
  distances: PairDistances;
  apply: Apply;
  // The pair the Add row picks, or null while the row is shut.
  draft: BondDraft | null;
  onDraft(next: BondDraft): void;
  // The identities of the rules detection made (ui/structure-config.ts). The panel edits this set as the rules change.
  automatic: Set<string>;
  // The detection settings the Detect group shows, and what its controls commit.
  detection: DetectionOptions;
  onDetection(next: DetectionOptions): void;
  // Runs the detection with these settings on the structure (the page supplies the structure).
  detect(options: DetectionOptions): BondRule[];
}

// The Add row's picks. A bond draft is its two names; a shape draft holds the text the user typed for the names, which
// namesFromText reads when the row adds the shape.
export type BondDraft = [string, string];

// The detection's tolerance: a fraction of the covalent-radius sum (BOND_TOLERANCE is the default).
const TOLERANCE_RANGE: Span = [0, 0.5];
const TOLERANCE_STEP = 0.01;

const BOND_STYLES: Choice<BondStyle>[] = [
  { text: "Solid", value: "solid" },
  { text: "Dashed", value: "dashed" },
  { text: "Dotted", value: "dotted" },
];

export function newBondDraft(distances: PairDistances, names: readonly string[]): BondDraft {
  return defaultBondNames(distances, names);
}

function bondSummary(rule: { min_distance: number; max_distance: number }): string {
  return windowSummary(rule.min_distance, rule.max_distance);
}

// The Detect group above the rules, then the Add row while it is open, then the rules.
export function bondsNodes(input: BondsInput): PaneNode[] {
  const rules = input.config.bonds.map((_rule, index) => bondNode(input, index));
  const add = input.draft === null ? [] : [addBondNode(input, input.draft)];
  return [detectNode(input), ...add, ...rules];
}

// Detect from radii: the settings, then the two actions. Re-detect replaces only the automatic rules; Clear removes them.
function detectNode({ config, automatic, detection, onDetection, detect, apply }: BondsInput): PaneNode {
  return {
    kind: "folder",
    title: "Detect from radii",
    expanded: true,
    children: [
      {
        kind: "number",
        label: "Tolerance",
        value: detection.tolerance,
        ...numberRange(TOLERANCE_RANGE, TOLERANCE_STEP),
        commit: (tolerance) => onDetection({ ...detection, tolerance }),
      },
      {
        kind: "checkbox",
        label: "Metal pairs",
        value: detection.metalPairs,
        commit: (metalPairs) => onDetection({ ...detection, metalPairs }),
      },
      {
        kind: "button",
        title: "Re-detect",
        commit: () => apply(() => redetect(config, automatic, detect(detection))),
      },
      {
        kind: "button",
        title: "Clear automatic",
        commit: () =>
          apply(() => {
            const next = clearAutomaticBonds(config, [...automatic]);
            replaceOwnership(automatic, []);
            return next;
          }),
      },
    ],
  };
}

// Re-detect: the owned pairs are re-detected (their rules replaced in place), and the set becomes the pairs the detection now
// owns (a pair a user rule holds stays the user's).
function redetect(config: SceneConfig, automatic: Set<string>, detected: BondRule[]): SceneConfig {
  const owned = [...automatic];
  const next = replaceAutomaticBonds(config, owned, detected);
  replaceOwnership(automatic, detectedOwnership(config, owned, detected));
  return next;
}

function bondNode(input: BondsInput, index: number): PaneNode {
  const { config, distances, apply, automatic } = input;
  const rule = config.bonds[index];
  // Any edit of the rule ends its automatic status: the rule is the user's from then on.
  const key = pairOf(rule);
  const change = endingAutomatic(apply, automatic, key);
  const isAutomatic = automatic.has(key);
  return {
    kind: "folder",
    title: pairName(rule.a, rule.b),
    summary: bondSummary(rule),
    origin: isAutomatic ? "automatic" : "manual",
    swatch: { rgba: rgbaOf(rule.color), dim: !rule.visible },
    visible: { value: rule.visible, commit: (visible) => change(() => setBondVisible(config, index, visible)) },
    expanded: false,
    children: [
      {
        kind: "interval",
        label: "Window",
        value: [rule.min_distance, rule.max_distance],
        ...distanceRange(pairDistances(distances, rule.a, rule.b)),
        commit: ([min, max]) => change(() => setBondWindow(config, index, min, max)),
      },
      {
        kind: "number",
        label: "Radius",
        value: rule.radius,
        ...numberRange(BOND_RADIUS_RANGE, RADIUS_STEP),
        commit: (radius) => change(() => setBondRadius(config, index, radius)),
      },
      {
        kind: "color",
        label: "Colour",
        alpha: true,
        value: rgbaOf(rule.color),
        commit: (rgba) => change(() => setBondColor(config, index, colorOf(rgba))),
      },
      {
        kind: "list",
        label: "Style",
        value: rule.style,
        options: BOND_STYLES,
        commit: (next) => change(() => setBondStyle(config, index, choiceValue(BOND_STYLES, next))),
      },
      { kind: "button", title: "Remove", commit: () => change(() => removeBondRule(config, index)) },
    ],
  };
}

function addBondNode({ config, names, distances, apply, onDraft }: BondsInput, picks: BondDraft): PaneNode {
  const first = chosenName(picks[0], names);
  const second = chosenName(picks[1], names);
  return {
    kind: "folder",
    title: "New bond",
    draft: true,
    expanded: true,
    children: [
      {
        kind: "list",
        label: "First atom",
        value: first,
        options: namesChoices(names),
        commit: (next) => onDraft([next, second]),
      },
      {
        kind: "list",
        label: "Second atom",
        value: second,
        options: namesChoices(names),
        commit: (next) => onDraft([first, next]),
      },
      {
        kind: "button",
        title: "Add bond",
        commit: () => {
          const [min, max] = firstShellWindow(pairDistances(distances, first, second));
          apply(() => addBondRule(config, first, second, min, max));
        },
      },
    ],
  };
}
