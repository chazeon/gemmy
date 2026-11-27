// The inspector's structure sections as plain data: each section is a list of nodes (folders, controls and buttons), each
// control with the value it shows and the commit that applies a change through the compile/config-edit-*.ts files. Nothing here imports
// a UI library: tweakpane-adapter.ts draws the nodes, and the node test reads them. A commit throws ConfigError for an edit
// the config refuses, and the apply it is given reports that to the section.
import type { Histogram } from "../../compile/pair-distances";
import type { Span } from "../../ui/style-panel-model";

// A colour as a colour picker holds it: channels from 0 to 1, alpha last.
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Choice<T extends string> {
  text: string;
  value: T;
}

// The nodes of a section. A value control shows `value` and calls `commit` with the new value; the adapter commits only when
// a change ends (a slider's drag is not a commit), so a commit runs one edit.
export type PaneNode =
  // A folder: its title, and a summary of its state that the adapter shows after the title while the folder is shut.
  | {
      kind: "folder";
      title: string;
      summary?: string;
      // Where a rule came from, for the rows that have an origin: a detected rule (automatic) or the user's own (manual).
      // The adapter draws it as an icon at the start of the summary.
      origin?: "automatic" | "manual";
      // The colour dot before the name, and whether the item is hidden (the dot is then drawn faded).
      swatch?: { rgba: Rgba; dim: boolean };
      // The eye before the name: whether the item is shown, and the commit that shows or hides it (the folder does not fold).
      visible?: { value: boolean; commit(next: boolean): void };
      // An add row (New bond, New shape): drawn with a "+" and in the muted colour, so it reads as an action.
      draft?: true;
      expanded: boolean;
      children: PaneNode[];
    }
  | { kind: "button"; title: string; commit(): void }
  // A read-only labelled row (the Selection's readout): the value is shown, never edited.
  | { kind: "readonly"; label: string; value: string }
  // Three numbers on one row (the adapter draws Tweakpane's point control): the cell's a, b and c.
  | {
      kind: "point3d";
      label: string;
      value: [number, number, number];
      min?: number;
      max?: number;
      step: number;
      // Per number, whether it is disabled (dimmed, and its box takes no input): the Supercell box of a non-periodic axis.
      disabled?: [boolean, boolean, boolean];
      commit(next: [number, number, number]): void;
    }
  | { kind: "checkbox"; label: string; value: boolean; commit(next: boolean): void }
  // Tick boxes on one row, each with its label (the Periodic row's a, b, c). Each item has its own value and commit.
  | { kind: "checks"; label: string; items: { label: string; value: boolean; commit(next: boolean): void }[] }
  // A colour. `alpha` is whether the colour takes transparency (the config's colour fields do): its picker then has an alpha
  // slider and its hex has eight digits, whatever the colour's alpha is now. Not a property of the value.
  // `default`, where the field has one, is the value a reset returns it to (a dot marks a value that differs from it).
  | { kind: "color"; label: string; value: Rgba; alpha: boolean; default?: Rgba; commit(next: Rgba): void }
  // A number: a plain field, its bounds only limit the commit. With `toggle`, a checkbox leads the row: its own value and commit, and the number is
  // dimmed and disabled while it is off (the number keeps its value). A toggle and its number share one row.
  | {
      kind: "number";
      label: string;
      value: number;
      min?: number;
      max?: number;
      step: number;
      toggle?: { value: boolean; commit(next: boolean): void };
      default?: number;
      commit(next: number): void;
    }
  // Two whole numbers on one row, the lower then the upper (a cluster's min_size and max_size): the boxes sit on the Supercell
  // row's grid (field-sizes.ts). A null upper is no limit, and its box is empty. `default`, where the field has one, is what a
  // reset returns it to (a dot marks a value that differs from it).
  | {
      kind: "sizes";
      label: string;
      value: [number, number | null];
      min: number;
      step: number;
      default?: [number, number | null];
      commit(next: [number, number | null]): void;
    }
  // A window; with a histogram (the distances the window can take) the adapter draws it as a range slider over the bars.
  | {
      kind: "interval";
      label: string;
      value: Span;
      min: number;
      max: number;
      step: number;
      histogram?: Histogram;
      commit(next: Span): void;
    }
  | { kind: "text"; label: string; value: string; commit(next: string): void }
  | { kind: "list"; label: string; value: string; options: Choice<string>[]; commit(next: string): void };

// The nodes that hold a value (everything but a folder and a button).
export type ValueNode = Exclude<PaneNode, { kind: "folder" } | { kind: "button" } | { kind: "checks" }>;

export function isValueNode(node: PaneNode): node is ValueNode {
  return node.kind !== "folder" && node.kind !== "button" && node.kind !== "checks";
}

// Whether a number differs from its default. The tolerance is a thousandth of the field's step, so a value a step away
// always counts as changed and float noise never does.
const DEFAULT_TOLERANCE = 1e-3;
const COLOUR_TOLERANCE = 1e-6;

export function isChangedFromDefault(node: ValueNode): boolean {
  if (node.kind === "number" && node.default !== undefined)
    return Math.abs(node.value - node.default) > node.step * DEFAULT_TOLERANCE;
  if (node.kind === "color" && node.default !== undefined) {
    const { value, default: fallback } = node;
    return (["r", "g", "b", "a"] as const).some(
      (channel) => Math.abs(value[channel] - fallback[channel]) > COLOUR_TOLERANCE,
    );
  }
  if (node.kind === "sizes" && node.default !== undefined) {
    const [low, high] = node.value;
    const [defaultLow, defaultHigh] = node.default;
    return low !== defaultLow || high !== defaultHigh;
  }
  return false;
}

// The nodes in the order a tree walk meets them (a folder, then its children): the adapter keeps one binding per node.
export function flattenPane(nodes: readonly PaneNode[]): PaneNode[] {
  return nodes.flatMap((node) => (node.kind === "folder" ? [node, ...flattenPane(node.children)] : [node]));
}

// The shape of a description without its values and commits: when two descriptions have the same key, the adapter writes
// the new values into the controls it has, and keeps the folders and the focus as they are. A folder's title is part of
// the shape, because the adapter writes values only: a title that changed (the Selection's atom, a polyhedron's ligands)
// needs a rebuild.
export function structureKey(nodes: readonly PaneNode[]): string {
  return JSON.stringify(nodes.map(shapeOf));
}

function shapeOf(node: PaneNode): unknown {
  switch (node.kind) {
    case "folder":
      return { kind: node.kind, title: node.title, expanded: node.expanded, children: node.children.map(shapeOf) };
    case "button":
      return { kind: node.kind, title: node.title };
    case "readonly":
      return { kind: node.kind, label: node.label };
    case "checks":
      return { kind: node.kind, label: node.label, items: node.items.map((item) => item.label) };
    case "point3d":
      return {
        kind: node.kind,
        label: node.label,
        min: node.min,
        max: node.max,
        step: node.step,
        disabled: node.disabled,
      };
    case "number":
      return {
        kind: node.kind,
        label: node.label,
        min: node.min,
        max: node.max,
        step: node.step,
        toggle: node.toggle !== undefined,
        hasDefault: node.default !== undefined,
      };
    case "color":
      return { kind: node.kind, label: node.label, hasDefault: node.default !== undefined };
    case "sizes":
      return {
        kind: node.kind,
        label: node.label,
        min: node.min,
        step: node.step,
        hasDefault: node.default !== undefined,
      };
    case "interval":
      return {
        kind: node.kind,
        label: node.label,
        min: node.min,
        max: node.max,
        step: node.step,
        histogram: node.histogram,
      };
    case "list":
      return { kind: node.kind, label: node.label, options: node.options };
    default:
      return { kind: node.kind, label: node.label };
  }
}
