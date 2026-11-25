// The lines of the view that are not fills: a polyhedron's hard edges, the cell box, and the thin bonds drawn as lines.
// Their visibility is not computed here: the line pass (passes.ts) renders them with three.js, and each sample asks
// whether its pixel shows that line's id.
import type * as THREE from "three";
import type { Pt } from "./curves";
import type { Passes } from "./buffers";
import type { Project, Projected } from "./passes";

// Spacing of the visibility samples along an edge, in output px. Each visible run ends within one spacing of the true
// end.
const SAMPLE_SPACING_PX = 0.5;
// The most samples a line may take, in multiples of the image's size: a segment longer than this (in render px) is
// never reached in practice, so a runaway count (an endpoint projected to infinity) stops here instead of hanging the
// export.
const MAX_SAMPLES_PER_IMAGE_EDGE = 4;
// The NDC depth range of the view: an endpoint outside it is behind the near plane or past the far one.
const NDC_DEPTH_MIN = -1;
const NDC_DEPTH_MAX = 1;
// The runs of consecutive samples 0..count (inclusive) where `on` holds, as [first, last] sample indices.
function runsWhere(count: number, on: (k: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= count; k++) {
    const now = on(k);
    if (now && start < 0) start = k;
    if ((!now || k === count) && start >= 0) {
      runs.push([start, now ? k : k - 1]);
      start = -1;
    }
  }
  return runs;
}

// The line pass (passes.ts) read per line: a sample of a 3D segment counts as visible when its pixels show that line's
// id. Three.js has done the depth test, so there is no depth tolerance here. A sample counts when any of its 3x3 pixels
// shows the id, because a one-pixel line can leave a sample just beside it. Each span ends within one sample spacing of
// the true end.
export class LinePass {
  constructor(
    readonly project: Project,
    private readonly passes: Passes,
    readonly scale: number, // render px per CSS px
  ) {}

  // The visible spans of the segment a-b of line `id`, as CSS px segments.
  spansOf(a: THREE.Vector3, b: THREE.Vector3, id: number): [Pt, Pt][] {
    const pa = this.project(a);
    const pb = this.project(b);
    // An endpoint that is not finite, or outside the depth range (behind the camera), has no screen position to sample:
    // the line is left out rather than projected to infinity.
    if (!onScreen(pa) || !onScreen(pb)) return [];
    const outputLength = Math.hypot(pb.x - pa.x, pb.y - pa.y) / this.scale;
    const sampleLimit = (MAX_SAMPLES_PER_IMAGE_EDGE * (this.passes.width + this.passes.height)) / SAMPLE_SPACING_PX;
    const count = Math.min(sampleLimit, Math.max(1, Math.ceil(outputLength / SAMPLE_SPACING_PX)));
    const visible = (k: number) => {
      const p = this.project(a.clone().lerp(b, k / count));
      return this.shows(id, Math.floor(p.x), Math.floor(p.y));
    };
    return runsWhere(count, visible).map(([first, last]): [Pt, Pt] => [
      this.cssAt(a, b, first / count),
      this.cssAt(a, b, last / count),
    ]);
  }

  // Whether any pixel of the 3x3 block around (x, y) shows line `id`.
  shows(id: number, x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.passes.lineIdAt(x + dx, y + dy) === id) return true;
      }
    }
    return false;
  }

  private cssAt(a: THREE.Vector3, b: THREE.Vector3, t: number): Pt {
    const p = this.project(a.clone().lerp(b, t));
    return [p.x / this.scale, p.y / this.scale];
  }
}

// Whether a projected point has a finite screen position and lies inside the depth range.
export function onScreen(p: Projected): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.depth >= NDC_DEPTH_MIN && p.depth <= NDC_DEPTH_MAX;
}
