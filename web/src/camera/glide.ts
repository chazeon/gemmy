// The glides: the view moves over GLIDE_MS to a new target and camera position (and, orthographic, a new zoom). The
// double-click glide moves the camera and the target together by one offset, so the view direction and the
// camera-to-target distance stay as they are (in perspective the zoom stays too). Each frame adds only its share of the
// move, so a move made meanwhile (a drag, a key) still counts.
import * as THREE from "three";
import { controls } from "../render/draw";
import { camera, requestRender } from "../state";

// How long a glide takes, in milliseconds.
export const GLIDE_MS = 300;

// The glide that may still move the view. Starting another glide, or a reset to the structure's centre, ends this one.
let current = 0;

// Glide so that `point` comes to the middle of the screen: the camera and the target move by the same offset.
export function glideTo(point: THREE.Vector3): void {
  const offset = point.clone().sub(controls.target);
  glideView(point, camera.position.clone().add(offset));
}

// Glide to a framing: the target goes to `target` and the camera to `position`. `zoom`, when given, is the orthographic
// zoom to reach (perspective frames by distance, so it has none). The view direction is kept when the start and end
// both lie on the view line through their targets, which the framings do.
export function glideView(target: THREE.Vector3, position: THREE.Vector3, zoom?: number): void {
  const id = ++current;
  const moveTarget = target.clone().sub(controls.target);
  const movePosition = position.clone().sub(camera.position);
  const zoomStart = camera.zoom;
  const started = performance.now();
  let shareMoved = 0; // how much of the move has been made already, from 0 to 1
  const step = (): void => {
    if (id !== current) return;
    const progress = (performance.now() - started) / GLIDE_MS;
    const share = THREE.MathUtils.smoothstep(progress, 0, 1);
    const part = share - shareMoved;
    camera.position.addScaledVector(movePosition, part);
    controls.target.addScaledVector(moveTarget, part);
    if (zoom !== undefined) {
      // multiplicative, so the steps compound to the wanted zoom; the last step sets it exactly
      camera.zoom = progress < 1 ? camera.zoom * Math.pow(zoom / zoomStart, part) : zoom;
      camera.updateProjectionMatrix();
    }
    shareMoved = share;
    requestRender();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Ends a glide in progress (the view is being reset somewhere else).
export function cancelGlide(): void {
  current++;
}
