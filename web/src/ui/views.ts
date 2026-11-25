// The look-along views: a, b and c look down the cell's axes, and "rotated" is the view of the 3to2d renders (LOOK in
// the config). The camera moves themselves are in camera/view.ts.
import * as THREE from "three";
import { LOOK } from "../config";
import { loaded } from "../state";
import { centreOnFrom, snapViewFrom, viewFrom } from "../camera/view";

// The unit direction, from the structure towards the camera, at an azimuth and an elevation in degrees.
function viewDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg),
    e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
}
// A look-along view: the direction from the structure to the camera, and the world direction shown up on screen.
interface Look {
  dir: THREE.Vector3;
  up: THREE.Vector3;
}
const WORLD_UP = new THREE.Vector3(0, 0, 1);
const rotatedLook = (): Look => ({ dir: viewDirection(LOOK.azimuth, LOOK.elevation), up: WORLD_UP });
const LOOKS: Record<string, () => Look> = {
  a: () => ({ dir: loaded.value.lattice[0], up: loaded.value.lattice[2] }),
  b: () => ({ dir: loaded.value.lattice[1], up: loaded.value.lattice[2] }),
  c: () => ({ dir: loaded.value.lattice[2], up: loaded.value.lattice[1] }),
  rotated: rotatedLook,
};

// The rotated view at once: a scene's first view, and an address that cannot be used (ui/stage.ts, ui/share.ts).
export function showRotated(): void {
  const { dir, up } = rotatedLook();
  snapViewFrom(dir, up);
}

// Looks along a view (a, b, c or rotated): the camera glides to it (camera/view.ts viewFrom).
export function lookAlong(view: keyof typeof LOOKS): void {
  const { dir, up } = LOOKS[view]();
  viewFrom(dir, up);
}

// Looks along a cell axis at an object (the selection card's a, b and c): the turn and the framing in one glide.
export function lookAlongAt(axis: "a" | "b" | "c", centre: THREE.Vector3, size: number): void {
  const { dir, up } = LOOKS[axis]();
  centreOnFrom(centre, size, dir, up);
}
