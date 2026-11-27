// Displacement arrows (compile/displacements.py): the vectors file read by its text, and one arrow per shown site.
import { vdot, vscale, vsub } from "../geom/vector";
import type { Vec3 } from "../types";
import { DataFileError, readData } from "./datafile";
import { withoutNegativeZero } from "./lattice";
import type { Site } from "./sites";

// A vector this short (in its own units) is no arrow.
const ZERO_VECTOR_NORM = 1e-12;

// The displacement file is missing or invalid; the message names the file.
export class DisplacementFileError extends Error {}

// Source-structure index -> displacement vector (unscaled).
export type VectorMap = Readonly<Record<number, Vec3>>;

export interface ArrowSpec {
  site: Site;
  vector: Vec3; // already scaled
  mode: "arrow" | "line";
  anchor: "tail" | "tip"; // "tip": the arrow ends at the atom
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Python's int() on a JSON value: a number (truncated), a bool, or a string of digits. Anything else raises.
function pyInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return withoutNegativeZero(Math.trunc(value));
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && /^\s*[+-]?\d+(?:_\d+)*\s*$/.test(value)) {
    return withoutNegativeZero(Number(value.trim().replace(/_/g, "")));
  }
  throw new TypeError(`int() cannot read ${String(value)}`);
}

// Python's float() on a JSON value: a number, a bool, or a decimal string. Anything else raises.
function pyFloat(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    return Number(value.trim());
  }
  throw new TypeError(`float() cannot read ${String(value)}`);
}

// displacements.load_displacement_file: `{"vectors": [{"index": 0, "dx": ..., "dy": ..., "dz": ...}, ...]}`.
export function loadDisplacementFile(name: string, text: string): VectorMap {
  let payload: unknown;
  try {
    payload = readData(name, text);
  } catch (error) {
    if (error instanceof DataFileError) throw new DisplacementFileError(`displacement file: ${error.message}`);
    throw error;
  }
  const vectors = isRecord(payload) ? payload.vectors : undefined;
  if (!Array.isArray(vectors)) {
    throw new DisplacementFileError(`displacement file ${name} must be an object with a 'vectors' list`);
  }
  const out: Record<number, Vec3> = {};
  vectors.forEach((item: unknown, n: number) => {
    try {
      if (!isRecord(item)) throw new TypeError("entry is not an object");
      out[pyInt(item.index)] = [pyFloat(item.dx), pyFloat(item.dy), pyFloat(item.dz)];
    } catch {
      throw new DisplacementFileError(`displacement file ${name}: vectors[${n}] needs numeric index, dx, dy, dz`);
    }
  });
  return out;
}

// displacements.make_displacements: one arrow per site in `shown` that has a non-zero vector. The caller decides
// whether hidden atoms count. With `inwardFrom` (a polyhedron centre), arrows pointing towards it get anchor "tip".
export function makeDisplacements(
  shown: Site[],
  vectors: VectorMap,
  baseCount: number,
  scale: number,
  style: string,
  inwardFrom?: Vec3 | null,
): ArrowSpec[] {
  const requested = style.toLowerCase();
  const mode = requested === "line" ? "line" : "arrow";
  const out: ArrowSpec[] = [];
  for (const site of shown) {
    let vec: Vec3 | undefined = vectors[site.index];
    if (vec === undefined && baseCount > 0) vec = vectors[site.index % baseCount];
    if (vec === undefined) continue;
    if (Math.hypot(...vec) <= ZERO_VECTOR_NORM) continue;
    const vector = vscale(vec, scale) as Vec3;
    // Points into the polyhedron: draw it outside, with the head on the corner.
    const pointsInward = inwardFrom != null && vdot(vec, vsub(site.position, inwardFrom)) < 0;
    const anchor = pointsInward ? "tip" : "tail";
    out.push({ site, vector, mode, anchor });
  }
  return out;
}
