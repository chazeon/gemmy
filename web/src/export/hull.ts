// Convex hulls and the lit region of an atom, for the SVG export. Pure: vectors in, vectors out.
import { Vector2, Vector3 } from "three";
import { EPS } from "../config";

// Samples round each of the two circles that bound a lit region.
const LIT_STEPS = 120;

// Convex hull (monotone chain), counter-clockwise in a y-up frame.
export function hull2d(points: Vector2[]): Vector2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const build = (list: Vector2[]): Vector2[] => {
    const out: Vector2[] = [];
    for (const q of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return sorted.length < 3 ? sorted : [...build(sorted), ...build([...sorted].reverse())];
}

// The z component of (a - o) x (b - o): positive when o, a, b turn counter-clockwise.
const turn = (o: Vector2, a: Vector2, b: Vector2): number =>
  new Vector2().subVectors(a, o).cross(new Vector2().subVectors(b, o));

// The lit part of a unit sphere seen from +z, as unit-disc coordinates (x right, y up): the spherical cap
// {n.L >= threshold} cut by the front hemisphere. Its boundary is the visible arc of the cap circle plus the rim
// points that are lit; the region is convex, so the hull of those samples is the region.
export function litRegion(light: Vector3, threshold: number): Vector2[] {
  const c0 = light.clone().multiplyScalar(threshold);
  const rho = Math.sqrt(1 - threshold * threshold);
  const u = new Vector3().crossVectors(light, new Vector3(0, 0, 1)).normalize();
  const v = new Vector3().crossVectors(light, u);
  const at = (phi: number) => c0.clone().addScaledVector(u, rho * Math.cos(phi)).addScaledVector(v, rho * Math.sin(phi));
  const samples: Vector3[] = [];
  for (let i = 0; i < LIT_STEPS; i++) {
    const n = at((i / LIT_STEPS) * 2 * Math.PI);
    if (n.z >= 0) samples.push(n);
  }
  // where the cap circle crosses the rim (n.z = 0): A cos(phi) + B sin(phi) = -c0.z
  const A = rho * u.z;
  const B = rho * v.z;
  const R = Math.hypot(A, B);
  if (R > EPS && Math.abs(c0.z) <= R) {
    const base = Math.atan2(B, A);
    const off = Math.acos(-c0.z / R);
    samples.push(at(base + off), at(base - off));
  }
  for (let i = 0; i < LIT_STEPS; i++) { // the rim: lit where n.L >= threshold
    const a = (i / LIT_STEPS) * 2 * Math.PI;
    const n = new Vector3(Math.cos(a), Math.sin(a), 0);
    if (n.dot(light) >= threshold) samples.push(n);
  }
  return hull2d(samples.map((n) => new Vector2(n.x, n.y)));
}
