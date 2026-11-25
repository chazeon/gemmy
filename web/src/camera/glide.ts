// The double-click glide: the view moves so a clicked point comes to the middle of the screen, over GLIDE_MS. The
// camera and the target move together by one offset, so the view direction and the camera-to-target distance stay as
// they are (in perspective the zoom stays too). Each frame adds only its share of the offset, so a move made meanwhile
// (a drag, a key) still counts.
import * as THREE from "three";
import { controls } from "../render/draw";
import { camera, requestRender } from "../state";

// How long a glide takes, in milliseconds.
export const GLIDE_MS = 300;

// The glide that may still move the view. Starting another glide, or a reset to the structure's centre, ends this one.
let current = 0;

// Glide so that `point` comes to the middle of the screen.
export function glideTo(point: THREE.Vector3): void {
  const id = ++current;
  const offset = point.clone().sub(controls.target);
  const started = performance.now();
  let shareMoved = 0; // how much of the offset has been moved already, from 0 to 1
  const step = (): void => {
    if (id !== current) return;
    const progress = (performance.now() - started) / GLIDE_MS;
    const share = THREE.MathUtils.smoothstep(progress, 0, 1);
    shiftView(offset.clone().multiplyScalar(share - shareMoved));
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

// Moves the camera and the target by the same amount.
function shiftView(delta: THREE.Vector3): void {
  camera.position.add(delta);
  controls.target.add(delta);
}
