// Putting a scene on the stage. Showing a scene sets its view (the address's #view, else the rotated view), selects the
// polyhedron nearest the middle and opens the readout. A live scene's new version is loaded in place instead, so the
// view and the selection stay as the user left them. The stage's controls are set up here too.
import { batch, effect } from "@preact/signals-core";
import { controls, outlineMaterial } from "../render/draw";
import { resize } from "../render/loop";
import { sceneBounds } from "../scene/bounds";
import { load } from "../scene/load";
import type { ViewPose } from "../camera/viewhash";
import { loaded, outlines, showAtoms, showBox } from "../state";
import type { Scene } from "../types";
import { applyPose, watchView } from "./share";
import { select } from "./picking";
import { dist } from "./readout";
import { infoChoice, narrowScreen, showInfo } from "./panels";
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

export function openScene(doc: Scene, view: ViewPose | null): void {
  place(doc);
  if (view) applyPose(view);
  else showRotated();
  const { centre, points, polyTargets } = loaded.value;
  const middle = [...polyTargets].sort(
    (p, q) =>
      dist(points.get(p.poly.center_point_id)!.position, centre) -
      dist(points.get(q.poly.center_point_id)!.position, centre),
  )[0];
  select(middle ?? null);
  showInfo(infoChoice() ?? (Boolean(middle) && !narrowScreen.matches)); // a phone opens with it folded
  watchView();
}

export function updateScene(doc: Scene): void {
  place(doc);
}

// ---- the Show flags ----
// The ☰ menu's checks set the flags (react/main-menu.tsx); the objects they show follow them here. A new scene's objects
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
