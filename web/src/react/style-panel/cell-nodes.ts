// The Cell section: the periodic switches and the supercell are rows (a single setting is a row), the display box is a folder.
import type { SceneConfig } from "../../compile/config";
import { setBox, setBoxEnds, setPeriodic, setSupercell } from "../../compile/config-edit-cell";
import { type Apply, MAX_SUPERCELL, boxOf } from "../../ui/style-panel-model";
import type { PaneNode } from "./pane-model";

const CELL_AXES = ["a", "b", "c"] as const;
const CELL_KEYS = ["x", "y", "z"] as const;
const SUPERCELL_MIN = 1;
const SUPERCELL_STEP = 1;
const BOX_STEP = 0.05;

// The two corners of the display box: From is its lower end on each axis, To its upper end.
type BoxEnd = "from" | "to";
type Triple = [number, number, number];

export function cellNodes(config: SceneConfig, apply: Apply): PaneNode[] {
  return [periodicNode(config, apply), supercellNode(config, apply), displayBoxNode(config, apply)];
}

function supercellNode(config: SceneConfig, apply: Apply): PaneNode {
  return {
    kind: "point3d",
    label: "Supercell",
    value: [...config.cell.supercell],
    min: SUPERCELL_MIN,
    max: MAX_SUPERCELL,
    step: SUPERCELL_STEP,
    // A supercell repeats only along a periodic axis: the boxes of the other axes are disabled (Periodic unticks them).
    disabled: config.cell.periodic.map((on) => !on) as [boolean, boolean, boolean],
    commit: (next) => apply(() => setSupercell(config, next)),
  };
}

// One row with an a, b, c tick box per axis; each axis keeps its own commit.
function periodicNode(config: SceneConfig, apply: Apply): PaneNode {
  return {
    kind: "checks",
    label: "Periodic",
    items: CELL_KEYS.map((axis, index) => ({
      label: CELL_AXES[index],
      value: config.cell.periodic[index],
      commit: (flag: boolean) => apply(() => setPeriodic(config, axis, flag)),
    })),
  };
}

function displayBoxNode(config: SceneConfig, apply: Apply): PaneNode {
  return {
    kind: "folder",
    title: "Display box",
    summary: boxSummary(config),
    expanded: false,
    children: [
      {
        kind: "point3d",
        label: "From",
        value: boxEnds(config, "from"),
        step: BOX_STEP,
        commit: (next) => apply(() => setBoxEnds(config, { from: next, to: boxEnds(config, "to") })),
      },
      {
        kind: "point3d",
        label: "To",
        value: boxEnds(config, "to"),
        step: BOX_STEP,
        commit: (next) => apply(() => setBoxEnds(config, { from: boxEnds(config, "from"), to: next })),
      },
      {
        kind: "button",
        title: "Reset box",
        commit: () => {
          if (isBoxed(config)) apply(() => CELL_KEYS.reduce((edit, axis) => setBox(edit, axis, null), config));
        },
      },
    ],
  };
}

// The display box's corner on each axis, in a, b, c order.
function boxEnds(config: SceneConfig, which: BoxEnd): Triple {
  const end = which === "from" ? 0 : 1;
  return CELL_KEYS.map((axis) => boxOf(config, axis)[end]) as Triple;
}

function isBoxed(config: SceneConfig): boolean {
  return CELL_KEYS.some((axis) => config.cell.box[axis] !== undefined);
}

function boxSummary(config: SceneConfig): string {
  if (!isBoxed(config)) return "full cell";
  return CELL_KEYS.map((axis, index) => {
    const [from, to] = boxOf(config, axis);
    return `${CELL_AXES[index]} ${trimmed(from)}–${trimmed(to)}`;
  }).join(" · ");
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(3)));
}
