// Vector helpers on plain number arrays, for the SVG export and the instancing, which work on the scene's own arrays.
// No THREE and no DOM, so the node tests can run them. The camera uses THREE.Vector3 where it can.
export type Vec = readonly number[];

// a + (b - a) * t, component by component: t = 0 is a, t = 1 is b.
export const lerp = (a: Vec, b: Vec, t: number): number[] => a.map((x, i) => x + (b[i] - x) * t);
// Straight-line distance between two 3D points.
export const span = (a: Vec, b: Vec): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
// The dot product: |a||b| cos(angle), so zero when the two are perpendicular.
export const vdot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// a minus b, component by component.
export const vsub = (a: Vec, b: Vec): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// The cross product: perpendicular to both a and b, with length |a||b| sin(angle).
export const vcross = (a: Vec, b: Vec): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// The unit vector along a. A zero vector stays zero (its length is taken as 1).
export function vunit(a: Vec): number[] {
  const length = Math.hypot(...a) || 1;
  return a.map((x) => x / length);
}
