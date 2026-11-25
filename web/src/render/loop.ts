// The frame loop, the sizing and the theme. The loop runs every animation frame, but draws the canvas and the triad only
// when something has marked the view dirty (requestRender). resize() refits the cameras to the stage, and the box colour
// follows the page theme.
import { fly } from "../camera/fly";
import { orthoFrame } from "../camera/framing";
import { currentZoom, fitFor, setShownZoom, shownZoom, syncClip } from "../camera/view";
import { EPS } from "../config";
import { camera, extent, fitValue, lens, requestRender, setFitValue, takeDirty } from "../state";
import { boxMaterial, controls, cssVar, orthoCamera, perspCamera, renderer, scene, stage } from "./draw";
import { drawTriad } from "./triad";

// The zoom that shows the structure at its fit is 100%.
const FIT_PERCENT = 100;

const zoomLevel = document.getElementById("zoom-level") as HTMLElement;

// Refits everything to the stage's size. A view that is at its fit stays at the fit (so the window resize does not
// leave it zoomed in or out); a zoomed view keeps its zoom.
export function resize(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  // The fit is judged on the shown zoom, the one the readout (and the user) sees: after a pivot the exported zoom differs.
  const atFit = Math.abs(shownZoom() - fitValue) < EPS;
  setFitValue(fitFor(width, height));
  fitOrthoFrustum(width, height);
  perspCamera.aspect = width / height;
  perspCamera.setFocalLength(lens); // the vertical field of view follows from the lens and this aspect (draw.ts)
  if (atFit) setShownZoom(fitValue);
  renderer.setSize(width, height);
  controls.handleResize();
  requestRender();
}

// The orthographic frustum: the structure's extent fits the stage in both directions.
function fitOrthoFrustum(width: number, height: number): void {
  const { halfWidth, halfHeight } = orthoFrame(extent, width, height);
  Object.assign(orthoCamera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
  orthoCamera.updateProjectionMatrix();
}

// The box colour is read from the --box variable again whenever the colour scheme or the page's data-theme changes.
function applyTheme(): void {
  boxMaterial.color.set(cssVar("--box").trim());
  requestRender();
}

// Draws one frame when the view is dirty. Fly and trackball movement run every frame and mark the view dirty themselves.
function frame(now = 0): void {
  requestAnimationFrame(frame);
  fly(now);
  controls.update(); // trackball drag needs a per-frame update; it only marks the view dirty when it moved
  if (takeDirty()) drawView();
}

function drawView(): void {
  syncClip();
  renderer.render(scene, camera);
  drawTriad();
  showZoomPercent();
}

// The percent is NaN until the stage has a size: fitValue comes from fitZoom, which divides the shorter side by the
// longer, so an unlaid-out stage (0 by 0) gives 0/0. The label stays blank until then.
function showZoomPercent(): void {
  const percent = Math.round((shownZoom() / fitValue) * FIT_PERCENT);
  const text = Number.isFinite(percent) ? `${percent}%` : "";
  // Written only when it changes: a redraw that leaves the percentage alone should not repaint the column beside it.
  if (zoomLevel.textContent !== text) zoomLevel.textContent = text;
}

// ---- start ----
// resize() refits the cameras and requests the redraw on every call.
controls.addEventListener("change", requestRender);
window.addEventListener("resize", resize);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
// The first frame can run before the page fonts and the triad's axis font are ready; redraw once they are.
document.fonts?.ready.then(requestRender);
applyTheme();
frame();
