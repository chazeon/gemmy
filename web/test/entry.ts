// The modules the node tests run (tests/viewer_bundle.py bundles this file). No DOM here; three.js math (Color,
// Vector3) is fine, since three is a dev dependency and bundles for node.
import { type Attempt, beginAttempt, invalidateAttempts } from "../src/ui/attempts";
import { groupFiles } from "../src/scene/drop";
export * from "../src/camera/framing";
export * from "../src/export/settings";
export * from "../src/scene/bounds";
export { makeView, vec3 } from "../src/export/view";
export * from "../src/geom/dashes";
export * from "../src/geom/vector";
export * from "../src/render/instancing";
export * from "../src/render/triad-layout";
export * from "../src/trace/buffers";
export * from "../src/trace/curves";
export * from "../src/trace/candidates";
export * from "../src/trace/ellipse";
export * from "../src/trace/measure";
export * from "../src/trace/field";
export * from "../src/trace/intersect";
export * from "../src/trace/stretch";
export { GEMMY, LOOK } from "../src/config";
export * from "../src/scene/source";
export * from "../src/scene/drop";
export * from "../src/scene/gist";
export * from "../src/scene/read";
export * from "../src/camera/viewhash";
export * from "../src/camera/view-state";
export * from "../src/ui/tab-model";
export { STAY, clearNote, fadingNote, line, note, setStanding, timed } from "../src/ui/message";
export * from "../src/ui/type-presets";
export * from "../src/ui/type-presets-file";
export * from "../src/structure/types";
export * from "../src/structure/elements";
export * from "../src/scene/examples";
export { compilerLoadMessage, compilerUrl, retryHref, scriptReplyProblem } from "../src/scene/compiler";
export { loaded } from "../src/state";
export { describe, readout } from "../src/ui/readout";
// The viewer's pure load helpers (ui/attempts.ts, ui/load-budgets.ts, ui/structure-load.ts), run by tests/test_ts_load.py.
export * from "../src/ui/attempts";
export {
  atomBudgetProblem,
  baseAtomBudgetProblem,
  sidecarBudgetProblem,
  expandedAtomCount,
  MAX_ATOMS_IN_PAGE,
} from "../src/ui/load-budgets";
export { namedMessage } from "../src/ui/structure-load";

// Test-only: a tab that loads and is closed. Each step is "load" (a new attempt) or "close" (the tab is closed); the
// result is whether each attempt is still current after the steps.
export function attemptStory(steps: string[]): boolean[] {
  const tab = { attempt: 0 };
  let open = true;
  const isOpen = () => open;
  const attempts: Attempt[] = [];
  for (const step of steps) {
    if (step === "load") attempts.push(beginAttempt(tab, isOpen));
    else if (step === "close") {
      open = false;
      invalidateAttempts(tab);
    }
  }
  return attempts.map((attempt) => attempt.current());
}

// Test-only: the dropped names grouped as the page groups them (structures by name, the rest as sidecars).
export function groupNames(names: string[]) {
  const groups = groupFiles(names, (name) => name);
  return { structures: groups.structures.map((group) => group.file), others: groups.others };
}

// The style panel's pure helpers (tests/test_view_style_panel.py).
export {
  applier,
  chosenName,
  defaultBondNames,
  defaultClusterAtoms,
  defaultPair,
  distanceDomain,
  distancesBetween,
  distancesWithin,
  firstShellWindow,
  pairDistances,
  withPart,
} from "../src/ui/style-panel-model";
export { elementPairKey } from "../src/compile/pair-distances";
export { pairOf } from "../src/compile/config-edit-bonds";
export { parseSceneConfig } from "../src/compile/config";
export { ConfigError } from "../src/compile/config-errors";

// The style sections' descriptions (react/style-panel/pane-model.ts): plain data, read by tests/test_view_style_pane.py.
export { styleTargetOf } from "../src/react/style-panel/style-target";
export { flattenPane, isChangedFromDefault, structureKey } from "../src/react/style-panel/pane-model";
export { bondDefaultKey, polyhedronDefaultKey, ringDefaultKey } from "../src/ui/structure-model";
// A colour as the hex text the colour fields show (react/style-panel/colour-hex.ts).
export { fromHex, toHex } from "../src/react/style-panel/colour-hex";
export { selectionNodes } from "../src/react/style-panel/selection-nodes";
export { atomsNodes } from "../src/react/style-panel/atoms-nodes";
export { bondsNodes, newBondDraft } from "../src/react/style-panel/bonds-nodes";
export { cellNodes } from "../src/react/style-panel/cell-nodes";
export { namesFromText, newShapeDraft, shapesNodes } from "../src/react/style-panel/shapes-nodes";

// The adapter's commit gate and value check (react/style-panel/tweakpane-commit.ts), read by tests/test_view_style_pane.py.
export { WriteGate, sameValue } from "../src/react/style-panel/tweakpane-commit";

// The range histogram's geometry (react/style-panel/range-histogram-layout.ts), read by tests/test_ts_range_histogram.py.
export {
  bandBox,
  barBoxes,
  decimalsOf,
  fractionOf,
  isHistogram,
  isRangeValue,
  movedWindow,
  snapToStep,
  valueAt,
} from "../src/react/style-panel/range-histogram-layout";
