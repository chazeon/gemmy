// The frame the Blender render uses (gemmy.render.runner.scene_bounds). No DOM.
import { Box3, Vector3 } from "three";
import type { Scene, Vec3 } from "../types";

export interface Bounds {
  centre: Vec3;
  extent: number;
}

// A scene smaller than this still gets a frame this big, in angstrom (the floor of geom.bounds).
const MIN_EXTENT = 1;

// The box over every point and over both ends of each displacement arrow, centred, with its diagonal as the extent.
// This is the same rule as gemmy.render.runner.scene_bounds, so the page frames what the render frames.
export function sceneBounds(scene: Scene): Bounds {
  // A repeated point id keeps its last position, as in the Python scene_bounds.
  const positions = new Map<string, Vec3>(scene.points.map((p): [string, Vec3] => [p.id, p.position]));
  const corners = [...positions.values(), ...arrowEnds(scene, positions)];
  if (corners.length === 0) return { centre: [0, 0, 0], extent: MIN_EXTENT };
  const box = new Box3().setFromPoints(corners.map((p) => new Vector3(...p)));
  const centre = box.getCenter(new Vector3());
  return { centre: [centre.x, centre.y, centre.z], extent: Math.max(box.getSize(new Vector3()).length(), MIN_EXTENT) };
}

// Both ends of each displacement arrow. The tail sits on its atom and the tip is `vector` away; anchor "tip" flips
// that, so the arrow ends on the atom. An arrow on a missing point contributes nothing.
function arrowEnds(scene: Scene, positions: Map<string, Vec3>): Vec3[] {
  const ends: Vec3[] = [];
  for (const d of scene.primitives.displacements) {
    const atom = positions.get(d.start_point_id);
    if (atom === undefined) continue;
    const far = atom.map((x, i) => x + d.vector[i]) as Vec3;
    const near = atom.map((x, i) => x - d.vector[i]) as Vec3;
    ends.push(...(d.anchor === "tip" ? [near, atom] : [atom, far]));
  }
  return ends;
}
