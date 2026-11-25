// The frame loop, the sizing and the theme. The loop runs every animation frame, but draws the canvas and the triad
// only when something has marked the view dirty (requestRender). resize() refits the cameras to the stage, and the box
// colour follows the page theme.
import { effect, type Signal } from "@preact/signals-core";
import { fly } from "../camera/fly";
import { orthoFrame } from "../camera/framing";
import { fitFor, readBack, shownNow, syncClip, zoomTo } from "../camera/view";
import { EPS } from "../config";
import { camera, fitValue, lens, loaded, outlines, requestRender, showAtoms, showBox, takeDirty } from "../state";
import { outlineScale } from "../ui/outline-scale";
import { systemDark, theme } from "../ui/theme";
import { boxMaterial, controls, cssVar, orthoCamera, perspCamera, renderer, scene, stage } from "./draw";
import { drawLiveTriad } from "./triad";
import { renderTriad } from "./triad3d";

// The zoom that shows the structure at its fit is 100%.
const FIT_PERCENT = 100;

const zoomLevel = document.getElementById("zoom-level") as HTMLElement;

// Refits everything to the stage's size. A view that is at its fit stays at the fit (so the window resize does not
// leave it zoomed in or out); a zoomed view keeps its zoom.
export function resize(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  // A view at its fit stays at the fit: the fit depends on the stage's size.
  const atFit = Math.abs(shownNow() - fitValue.value) < EPS;
  fitValue.value = fitFor(width, height);
  fitOrthoFrustum(width, height);
  perspCamera.aspect = width / height;
  perspCamera.setFocalLength(lens.value); // the vertical field of view follows from the lens and this aspect (draw.ts)
  if (atFit) zoomTo(fitValue.value);
  renderer.setSize(width, height);
  controls.handleResize();
  requestRender();
}

// The orthographic frustum: the structure's extent fits the stage in both directions.
function fitOrthoFrustum(width: number, height: number): void {
  const { halfWidth, halfHeight } = orthoFrame(loaded.value.extent, width, height);
  Object.assign(orthoCamera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
  orthoCamera.updateProjectionMatrix();
}

// The one render effect: the picture depends on these signals, so a change to any of them marks the view dirty. A camera
// move calls requestRender itself (camera/view.ts commit, and the trackball's change below), so the glides and the fly
// keys redraw through it too; the camera's own state is not a signal, which is why it is not in this list.
const PICTURE: readonly Signal<unknown>[] = [loaded, outlines, outlineScale, showAtoms, showBox, theme, systemDark];
effect(() => {
  for (const part of PICTURE) void part.value;
  requestRender();
});

// The box colour is read from the --box variable again whenever the theme or the system's scheme changes (theme.ts
// sets the page's attribute before its signal, so the variable read here is the new one). The render effect redraws.
effect(() => {
  void [theme.value, systemDark.value];
  boxMaterial.color.set(cssVar("--box").trim());
});

// Draws one frame when the view is dirty. Fly and trackball movement run every frame and mark the view dirty
// themselves.
function frame(now = 0): void {
  requestAnimationFrame(frame);
  fly(now);
  controls.update(); // trackball drag needs a per-frame update; it only marks the view dirty when it moved
  readBack(); // the state follows whatever the trackball did to the camera
  if (takeDirty()) drawView();
}

function drawView(): void {
  syncClip();
  renderer.render(scene, camera.value);
  renderTriad();
  drawLiveTriad();
  showZoom();
}

// The zoom readout: the percentage of the fit, as the view stands. It is written on each drawn frame, and every camera
// move, refit and resize asks for one. The percent is NaN until the stage has a size: fitValue comes from fitZoom, which
// divides the shorter side by the longer, so an unlaid-out stage (0 by 0) gives 0/0. The label stays blank until then.
// The label is written only when its text changes: a write each frame would repaint the zoom buttons' column.
function showZoom(): void {
  const percent = Math.round((shownNow() / fitValue.value) * FIT_PERCENT);
  const text = Number.isFinite(percent) ? `${percent}%` : "";
  if (zoomLevel.textContent !== text) zoomLevel.textContent = text;
}

// ---- start ----
// resize() refits the cameras and requests the redraw on every call. The trackball's change is a camera move.
controls.addEventListener("change", requestRender);
window.addEventListener("resize", resize);
// The first frame can run before the page fonts and the triad's axis font are ready; redraw once they are.
document.fonts?.ready.then(requestRender);
frame();
