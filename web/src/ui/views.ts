// The look-along views: a, b and c look down the cell's axes, and "rotated" is the view of the 3to2d renders (LOOK in
// the config). The camera moves themselves are in camera/view.ts.
import * as THREE from "three";
import { LOOK } from "../config";
import { loaded } from "../state";
import { viewFrom } from "../camera/view";

function viewDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg),
    e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
}
export const VIEWS: Record<string, () => void> = {
  a: () => viewFrom(loaded.value.lattice[0], loaded.value.lattice[2]),
  b: () => viewFrom(loaded.value.lattice[1], loaded.value.lattice[2]),
  c: () => viewFrom(loaded.value.lattice[2], loaded.value.lattice[1]),
  rotated: () => viewFrom(viewDirection(LOOK.azimuth, LOOK.elevation), new THREE.Vector3(0, 0, 1)),
};

// Wires the [data-view] buttons to their views.
export function wireViewButtons(): void {
  for (const button of document.querySelectorAll<HTMLElement>("[data-view]")) {
    button.addEventListener("click", () => VIEWS[button.dataset.view ?? ""]());
  }
}
