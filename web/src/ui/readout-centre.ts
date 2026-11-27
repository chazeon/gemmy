// The Center buttons of the selection card: frame the shown object, or look along a cell axis at it (the card's a, b and
// c). They draw the page's camera, so they are apart from the readout's text (ui/readout.ts).
import * as THREE from "three";
import { loaded, type Target } from "../state";
import { centreOn } from "../camera/view";
import { lookAlongAt } from "./views";
import { pointOf, shownTarget } from "./readout";

// The Center button's framing: the object's centre and size in scene units (the origin is the structure's middle). An
// atom's size is its diameter; a bond's is its length plus a radius at each end; a polyhedron's is the diagonal of the
// box round its corners, and its centre the box's.
function objectBounds(target: Target): { centre: THREE.Vector3; size: number } {
  const offset = new THREE.Vector3(...loaded.value.centre);
  if (target.kind === "atom") {
    const position = new THREE.Vector3(...pointOf(target.atom.point_id).position).sub(offset);
    return { centre: position, size: 2 * target.atom.radius };
  }
  if (target.kind === "bond") {
    const a = new THREE.Vector3(...pointOf(target.bond.a_point_id).position);
    const b = new THREE.Vector3(...pointOf(target.bond.b_point_id).position);
    return { centre: a.clone().lerp(b, 0.5).sub(offset), size: a.distanceTo(b) + 2 * target.bond.radius };
  }
  const corners = target.poly.ligand_point_ids.map((id) => new THREE.Vector3(...pointOf(id).position));
  const box = new THREE.Box3().setFromPoints(corners);
  return { centre: box.getCenter(new THREE.Vector3()).sub(offset), size: box.min.distanceTo(box.max) };
}

// The Center button: frames the shown object.
export function centreShown(): void {
  const shown = shownTarget();
  if (!shown) return;
  const { centre, size } = objectBounds(shown);
  centreOn(centre, size);
}

// The same, looking along a cell axis (the card's a, b and c).
export function centreShownAlong(axis: "a" | "b" | "c"): void {
  const shown = shownTarget();
  if (!shown) return;
  const { centre, size } = objectBounds(shown);
  lookAlongAt(axis, centre, size);
}
