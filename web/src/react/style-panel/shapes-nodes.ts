// The Shapes section: the Detect group, the Add row (a polyhedron or a cluster), and one folder per polyhedron and cluster.
import type { ClusterRule, PolyhedronRule, SceneConfig } from "../../compile/config";
import {
  addClusterRule,
  clearAutomaticRings,
  detectedRingsOwnership,
  removeClusterRule,
  replaceAutomaticRings,
  ringKeyOf,
  setClusterAtoms,
  setClusterColor,
  setClusterKind,
  setClusterVisible,
  setClusterWindow,
} from "../../compile/config-edit-clusters";
import { setElementVisible } from "../../compile/config-edit-elements";
import type { DetectedShapes } from "../../compile/default-kind";
import {
  addPolyhedronReplacingBonds,
  clearAutomaticPolyhedra,
  detectedPolyhedraOwnership,
  removePolyhedronRule,
  replaceAutomaticPolyhedra,
  setPolyhedronCenter,
  setPolyhedronColor,
  setPolyhedronImageCentres,
  setPolyhedronLigands,
  setPolyhedronVisible,
  setPolyhedronWindow,
} from "../../compile/config-edit-polyhedra";
import { ConfigError } from "../../compile/config-errors";
import {
  type Apply,
  defaultClusterAtoms,
  distancesBetween,
  distancesWithin,
  elementStyleOf,
  firstShellWindow,
  type PairDistances,
} from "../../ui/style-panel-model";
import type { Choice, PaneNode } from "./pane-model";
import {
  choiceValue,
  colorOf,
  distanceRange,
  endingAutomatic,
  namesChoices,
  replaceOwnership,
  rgbaOf,
  windowSummary,
} from "./node-helpers";

export interface ShapesInput {
  config: SceneConfig;
  names: readonly string[];
  distances: PairDistances;
  apply: Apply;
  draft: ShapeDraft | null;
  onDraft(next: ShapeDraft): void;
  // The centre elements whose polyhedra detection made (ui/structure-model.ts). The panel edits this set as they change.
  automatic: Set<string>;
  // The ring patterns detection made (ui/structure-model.ts). The panel edits this set as the rings change.
  automaticRings: Set<string>;
  // Runs the shape detection on the structure (the page supplies the structure): the polyhedra or the rings its kind takes.
  detect(): DetectedShapes;
}

export interface ShapeDraft {
  kind: "polyhedron" | "cluster";
  centre: string;
  ligands: string;
  clusterKind: ClusterRule["kind"];
  atoms: string;
}

const NAMES_SEPARATOR = ", ";

const DEFAULT_CLUSTER_KIND: ClusterRule["kind"] = "molecule";
const NO_CENTRE: Choice<string> = { text: "Choose an atom", value: "" };

const CLUSTER_KINDS: Choice<ClusterRule["kind"]>[] = [
  { text: "Molecule", value: "molecule" },
  { text: "Ring", value: "ring" },
];
const SHAPE_KINDS: Choice<ShapeDraft["kind"]>[] = [
  { text: "Polyhedron", value: "polyhedron" },
  { text: "Cluster", value: "cluster" },
];

export function newShapeDraft(distances: PairDistances, names: readonly string[]): ShapeDraft {
  return {
    kind: "polyhedron",
    centre: "",
    ligands: "",
    clusterKind: DEFAULT_CLUSTER_KIND,
    atoms: defaultClusterAtoms(distances, names).join(NAMES_SEPARATOR),
  };
}

// The Detect group above the polyhedra, then the Add row while it is open, then the polyhedra and clusters.
export function shapesNodes(input: ShapesInput): PaneNode[] {
  const { config, draft } = input;
  const polyhedra = config.polyhedra.map((_, index) => polyhedronNode(input, index));
  const clusters = config.clusters.map((_, index) => clusterNode(input, index));
  const addRow = draft === null ? [] : [addShapeNode(input, draft)];
  return [detectShapesNode(input), ...addRow, ...polyhedra, ...clusters];
}

// Detect shapes: Re-detect replaces only the automatic polyhedra and rings; Clear removes them. There is no tolerance to set:
// the shapes take the default detection windows.
function detectShapesNode(input: ShapesInput): PaneNode {
  const { config, automatic, automaticRings, detect, apply } = input;
  return {
    kind: "folder",
    title: "Detect shapes",
    expanded: true,
    children: [
      {
        kind: "button",
        title: "Re-detect",
        commit: () => apply(() => redetectShapes(config, automatic, automaticRings, detect())),
      },
      {
        kind: "button",
        title: "Clear automatic",
        commit: () =>
          apply(() => {
            const next = clearAutomaticRings(clearAutomaticPolyhedra(config, [...automatic]), [...automaticRings]);
            replaceOwnership(automatic, []);
            replaceOwnership(automaticRings, []);
            return next;
          }),
      },
    ],
  };
}

// Re-detect for shapes: the owned centres and ring patterns are re-detected, and each set becomes what the detection now owns
// (a centre or pattern a user cluster holds stays the user's). Both ownerships are read from the config before the edit.
export function redetectShapes(
  config: SceneConfig,
  automatic: Set<string>,
  automaticRings: Set<string>,
  detected: DetectedShapes,
): SceneConfig {
  const owned = [...automatic];
  const ownedRings = [...automaticRings];
  const polyhedra = replaceAutomaticPolyhedra(config, owned, detected.polyhedra, detected.emitted);
  const next = replaceAutomaticRings(polyhedra, ownedRings, detected.rings);
  const centres = detectedPolyhedraOwnership(config, owned, detected.polyhedra);
  const patterns = detectedRingsOwnership(config, ownedRings, detected.rings);
  replaceOwnership(automatic, centres);
  replaceOwnership(automaticRings, patterns);
  return next;
}

function polyhedronNode(input: ShapesInput, index: number): PaneNode {
  const { config, names, distances, apply, automatic } = input;
  const rule = config.polyhedra[index];
  const ligands = rule.ligands.join(NAMES_SEPARATOR);
  // Any edit of the polyhedron ends its automatic status: the rule is the user's from then on.
  const change = endingAutomatic(apply, automatic, rule.center);
  const isAutomatic = automatic.has(rule.center);
  const windowText = windowSummary(rule.min_distance, rule.max_distance);
  return {
    kind: "folder",
    title: polyhedronFolderTitle(rule),
    summary: windowText,
    origin: isAutomatic ? "automatic" : "manual",
    swatch: { rgba: rgbaOf(rule.color), dim: !rule.visible },
    visible: { value: rule.visible, commit: (visible) => change(() => setPolyhedronVisible(config, index, visible)) },
    expanded: false,
    children: [
      {
        kind: "list",
        label: "Centre",
        value: rule.center,
        options: namesChoices(names),
        commit: (next) => change(() => setPolyhedronCenter(config, index, next)),
      },
      {
        kind: "text",
        label: "Ligands",
        value: ligands,
        commit: (text) => change(() => setPolyhedronLigands(config, index, namesFromText(text, names))),
      },
      {
        kind: "checkbox",
        label: "Show centre atom",
        value: elementStyleOf(config, rule.center).visible,
        commit: (visible) => change(() => setElementVisible(config, rule.center, visible)),
      },
      {
        kind: "checkbox",
        label: "Image centres",
        value: rule.image_centers,
        commit: (on) => change(() => setPolyhedronImageCentres(config, index, on)),
      },
      {
        kind: "interval",
        label: "Window",
        value: [rule.min_distance, rule.max_distance],
        ...distanceRange(distancesBetween(distances, rule.center, rule.ligands)),
        commit: ([min, max]) => change(() => setPolyhedronWindow(config, index, min, max)),
      },
      {
        kind: "color",
        label: "Colour",
        alpha: true,
        value: rgbaOf(rule.color),
        commit: (rgba) => change(() => setPolyhedronColor(config, index, colorOf(rgba))),
      },
      { kind: "button", title: "Remove", commit: () => change(() => removePolyhedronRule(config, index)) },
    ],
  };
}

function clusterNode({ config, names, distances, apply, automaticRings }: ShapesInput, index: number): PaneNode {
  const rule = config.clusters[index];
  const atoms = rule.atoms.join(NAMES_SEPARATOR);
  const key = ringKeyOf(rule);
  // Any edit of the cluster ends its automatic status: the rule is the user's from then on.
  const change = endingAutomatic(apply, automaticRings, key);
  const isAutomatic = automaticRings.has(key);
  const windowText = windowSummary(rule.min_distance, rule.max_distance);
  return {
    kind: "folder",
    title: shapeTitle(atoms, rule.kind),
    summary: windowText,
    origin: isAutomatic ? "automatic" : "manual",
    swatch: { rgba: rgbaOf(rule.color), dim: !rule.visible },
    visible: { value: rule.visible, commit: (visible) => change(() => setClusterVisible(config, index, visible)) },
    expanded: false,
    children: [
      {
        kind: "list",
        label: "Kind",
        value: rule.kind,
        options: CLUSTER_KINDS,
        commit: (next) => change(() => setClusterKind(config, index, choiceValue(CLUSTER_KINDS, next))),
      },
      {
        kind: "text",
        label: "Atoms",
        value: atoms,
        commit: (text) => change(() => setClusterAtoms(config, index, namesFromText(text, names))),
      },
      {
        kind: "interval",
        label: "Window",
        value: [rule.min_distance, rule.max_distance],
        ...distanceRange(distancesWithin(distances, rule.atoms)),
        commit: ([min, max]) => change(() => setClusterWindow(config, index, min, max)),
      },
      {
        kind: "color",
        label: "Colour",
        alpha: true,
        value: rgbaOf(rule.color),
        commit: (rgba) => change(() => setClusterColor(config, index, colorOf(rgba))),
      },
      { kind: "button", title: "Remove", commit: () => change(() => removeClusterRule(config, index)) },
    ],
  };
}

function addShapeNode(input: ShapesInput, draft: ShapeDraft): PaneNode {
  const { onDraft } = input;
  const shapeControl: PaneNode = {
    kind: "list",
    label: "Shape",
    value: draft.kind,
    options: SHAPE_KINDS,
    commit: (next) => onDraft({ ...draft, kind: choiceValue(SHAPE_KINDS, next) }),
  };
  const kindControls =
    draft.kind === "polyhedron" ? polyhedronDraftNodes(input, draft) : clusterDraftNodes(input, draft);
  return {
    kind: "folder",
    title: "New shape",
    draft: true,
    expanded: true,
    children: [shapeControl, ...kindControls],
  };
}

function polyhedronDraftNodes(
  { names, apply, distances, config, onDraft }: ShapesInput,
  draft: ShapeDraft,
): PaneNode[] {
  return [
    {
      kind: "list",
      label: "Centre",
      value: draft.centre,
      options: [NO_CENTRE, ...namesChoices(names)],
      commit: (next) => onDraft({ ...draft, centre: next }),
    },
    {
      kind: "text",
      label: "Ligands",
      value: draft.ligands,
      commit: (text) => onDraft({ ...draft, ligands: text }),
    },
    {
      kind: "button",
      title: "Add polyhedron",
      commit: () =>
        apply(() => {
          if (!names.includes(draft.centre)) throw new ConfigError("Choose the centre atom first.");
          const ligands = namesFromText(draft.ligands, names);
          if (ligands.length === 0) throw new ConfigError("Choose at least one ligand.");
          const [min, max] = firstShellWindow(distancesBetween(distances, draft.centre, ligands));
          return addPolyhedronReplacingBonds(config, draft.centre, ligands, min, max);
        }),
    },
  ];
}

function clusterDraftNodes({ names, apply, distances, config, onDraft }: ShapesInput, draft: ShapeDraft): PaneNode[] {
  return [
    {
      kind: "list",
      label: "Kind",
      value: draft.clusterKind,
      options: CLUSTER_KINDS,
      commit: (next) => onDraft({ ...draft, clusterKind: choiceValue(CLUSTER_KINDS, next) }),
    },
    {
      kind: "text",
      label: "Atoms",
      value: draft.atoms,
      commit: (text) => onDraft({ ...draft, atoms: text }),
    },
    {
      kind: "button",
      title: "Add cluster",
      commit: () =>
        apply(() => {
          const atoms = namesFromText(draft.atoms, names);
          if (atoms.length === 0) throw new ConfigError("Choose at least one atom.");
          const [min, max] = firstShellWindow(distancesWithin(distances, atoms));
          return addClusterRule(config, draft.clusterKind, atoms, min, max);
        }),
    },
  ];
}

// The folder title of a polyhedron rule: its centre and ligands ("Fe (O)"), as the style target finds it (style-target.ts).
export function polyhedronFolderTitle(rule: PolyhedronRule): string {
  return `${rule.center} (${rule.ligands.join(NAMES_SEPARATOR)})`;
}

export function shapeTitle(name: string, kind: string): string {
  return `${name} · ${kind}`;
}

// The names a text control holds ("O, F"), each one an atom of the structure. An unknown name is refused, so the edit
// reports it instead of making a rule that matches nothing.
export function namesFromText(text: string, names: readonly string[]): string[] {
  const picked = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const unknown = picked.find((name) => !names.includes(name));
  if (unknown !== undefined) throw new ConfigError(`"${unknown}" is not an atom of this structure.`);
  return picked;
}
