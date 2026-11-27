// Putting a scene on the stage. Showing a scene sets its view (the address's #view, else the rotated view), selects the
// polyhedron nearest the middle and opens the readout. A file shown again restores the view and selection it was left with
// (memoryOfStage). A live scene's new version is loaded in place instead, so the view and the selection stay as the user left
// them. The stage's controls are set up here too.
import { batch, effect } from "@preact/signals-core";
import { viewNow, setView } from "../camera/view";
import type { ViewState } from "../camera/view-state";
import { controls, outlineMaterial } from "../render/draw";
import { resize } from "../render/loop";
import { sceneBounds } from "../scene/bounds";
import { load } from "../scene/load";
import type { ViewPose } from "../camera/viewhash";
import { type PolyTarget, type Target, loaded, outlines, showAtoms, showBox } from "../state";
import type { Scene } from "../types";
import { captureMode } from "./capture";
import { applyPose, watchView } from "./share";
import { keyOf, targetOfKey } from "./selection-key";
import { select } from "./picking";
import { releasePivot } from "./pivot";
import { dist, shownTarget } from "./readout";
import { detailsStartsOpen, inspectorStartsOpen, showDetails, showInspector } from "./panels";
import { showRotated } from "./views";

// ---- how the controls feel ----
// The feel of a drag on the stage: how far it turns, zooms and pans the view (three's orbit controls), with no easing
// after the drag ends.
const DRAG_FEEL = { rotateSpeed: 3, zoomSpeed: 1.2, panSpeed: 0.8, staticMoving: true };

// Replaces what is on the stage with `doc`, framed to it, and resizes the view to the stage in the same change.
function place(doc: Scene): void {
  select(null);
  batch(() => {
    load(doc, sceneBounds(doc));
    resize();
  });
}

// What a file keeps while another file is on the stage: its camera (the view's target is the pivot) and the identity of its
// selection (ui/selection-key.ts), which is null when nothing is selected.
export interface FileMemory {
  view: ViewState;
  selection: string | null;
}

export function memoryOfStage(): FileMemory {
  const target = shownTarget();
  return { view: viewNow(), selection: target ? keyOf(target) : null };
}

// The polyhedron nearest the middle is the one a scene first shows. Its distance is rounded to a micro-unit (1e-6) and a tie goes
// to the first in scene order, so the choice does not depend on floating-point noise.
function nearestPolyhedron(): PolyTarget | null {
  const { centre, points, polyTargets } = loaded.value;
  const nearest = polyTargets
    .map((target, index) => ({
      target,
      index,
      away: Math.round(dist(points.get(target.poly.center_point_id)!.position, centre) * 1e6),
    }))
    .sort((p, q) => p.away - q.away || p.index - q.index)[0];
  return nearest?.target ?? null;
}

// Shows a scene. A file with a memory keeps its view and selection; otherwise the view is the address's (or the rotated one) and
// the selection the nearest polyhedron.
export function openScene(doc: Scene, view: ViewPose | null, memory: FileMemory | null): void {
  place(doc);
  if (memory) setView(memory.view);
  else if (view) applyPose(view);
  else showRotated();
  if (captureMode) return; // the stage alone: no selection highlight, no cards, no address writes
  let selected: Target | null = nearestPolyhedron();
  if (memory) selected = memory.selection === null ? null : targetOfKey(memory.selection);
  select(selected);
  // The card opens at the picked object and the dock on a wide screen; a phone opens with both folded (ui/panels.ts).
  showDetails(detailsStartsOpen(selected !== null));
  showInspector(inspectorStartsOpen());
  watchView();
}

// A live refresh or a style edit: the new scene replaces the old, and the selection is found again by its identity
// (ui/selection-key.ts). When the object is gone, the selection and the pivot are cleared.
export function updateScene(doc: Scene): void {
  const before = shownTarget();
  const key = before ? keyOf(before) : null;
  place(doc);
  if (!before) return;
  const again = key === null ? null : targetOfKey(key);
  if (again) select(again);
  else releasePivot();
}

// ---- the Show flags ----
// The view checks set the flags (react/style-panel/view-section.tsx); the objects they show follow them here. A new scene's objects
// are hidden or shown by the flags too, since they follow `loaded`.
export function wireStage(): void {
  Object.assign(controls, DRAG_FEEL);
  effect(() => {
    loaded.value.atomGroup.visible = showAtoms.value;
  });
  effect(() => {
    outlineMaterial.visible = outlines.value;
  });
  effect(() => {
    const { box } = loaded.value;
    if (box) box.visible = showBox.value;
  });
}
