// The geometry readout: the details panel's text for the selected atom or polyhedron (distances, the distortion, the
// fractional and Cartesian positions), the Copy button that takes an atom's reference, and the Center button that
// frames the shown object as Fit frames the structure. The text comes from the page's <template>s (web/page.html),
// filled as text.
import * as THREE from "three";
import { loaded, type Target } from "../state";
import { centreOn } from "../camera/view";
import type { AtomPrimitive, Point, PolyhedronPrimitive, Vec3 } from "../types";
import { byId, closestOf, cloneTemplate, setSlot } from "./dom";

const info = byId("info-body");
const ANGSTROM_DIGITS = 3;
const FRACTIONAL_DIGITS = 4;
const DELTA_SCALE = 1e4; // the distortion is shown in units of 10^-4
const COPY_FEEDBACK_MS = 1500;
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

// The distance between two points, in the scene's units (angstroms).
export function dist(a: Vec3, b: Vec3): number {
  return new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
}

function pointOf(id: string): Point {
  const point = loaded.value.points.get(id);
  if (!point) throw new Error(`gemmy viewer: the scene has no point ${id}`);
  return point;
}
// A number written with fixed digits, as the readout shows it.
function formatDigits(x: number, digits = ANGSTROM_DIGITS): string {
  return x.toFixed(digits);
}
function average(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}
// Digits as subscripts, so a polyhedron named "Si6" reads Si₆.
function subscripts(s: string): string {
  return s.replace(/\d+/g, (m) => [...m].map((c) => SUBSCRIPT_DIGITS[Number(c)]).join(""));
}
// Equal distances written once with a count: "2 × 1.970, 2.011".
function grouped(values: number[]): string {
  const counts = new Map<string, number>();
  for (const x of values) counts.set(formatDigits(x), (counts.get(formatDigits(x)) || 0) + 1);
  return [...counts]
    .sort((p, q) => Number(p[0]) - Number(q[0]))
    .map(([x, n]) => (n > 1 ? `${n} × ${x}` : x))
    .join(", ");
}

// A row the readout does not need is removed; its template text goes with it.
function dropRow(root: DocumentFragment, row: string): void {
  for (const element of root.querySelectorAll(`[data-row="${row}"]`)) element.remove();
}

// The Center button's framing: the object's centre and size in scene units (the origin is the structure's middle). An
// atom's size is its diameter; a polyhedron's is the diagonal of the box round its corners, and its centre the box's.
function objectBounds(target: Target): { centre: THREE.Vector3; size: number } {
  const offset = new THREE.Vector3(...loaded.value.centre);
  if (target.kind === "atom") {
    const position = new THREE.Vector3(...pointOf(target.atom.point_id).position).sub(offset);
    return { centre: position, size: 2 * target.atom.radius };
  }
  const corners = target.poly.ligand_point_ids.map((id) => new THREE.Vector3(...pointOf(id).position));
  const box = new THREE.Box3().setFromPoints(corners);
  return { centre: box.getCenter(new THREE.Vector3()).sub(offset), size: box.min.distanceTo(box.max) };
}

function polyhedronReadout(p: PolyhedronPrimitive): DocumentFragment {
  const centre = pointOf(p.center_point_id);
  const bonds = p.ligand_point_ids.map((id) => dist(centre.position, pointOf(id).position));
  const mean = average(bonds);
  const distortion = average(bonds.map((x) => ((x - mean) / mean) ** 2));
  const centreText = centre.fractional
    ? `${centre.element} at (${centre.fractional.map((x) => formatDigits(x, FRACTIONAL_DIGITS)).join(", ")})`
    : centre.element;
  const root = cloneTemplate("polyhedron-readout");
  setSlot(root, "name", subscripts(p.name ?? "Polyhedron"));
  setSlot(root, "centre", centreText);
  setSlot(root, "bonds", grouped(bonds));
  setSlot(root, "mean", formatDigits(mean));
  setSlot(root, "delta", (distortion * DELTA_SCALE).toFixed(2));
  root.querySelector('[data-slot="view"]')!.append(cloneTemplate("center-button"));
  return root;
}

function atomReadout(a: AtomPrimitive): DocumentFragment {
  const point = pointOf(a.point_id);
  const hosts = loaded.value.polyhedra.filter((p) => p.ligand_point_ids.includes(a.point_id));
  const neighbours = hosts.map((p) => dist(point.position, pointOf(p.center_point_id).position));
  const root = cloneTemplate("atom-readout");
  setSlot(root, "element", point.element);
  if (point.ref) {
    setSlot(root, "ref", point.ref);
    root.querySelector<HTMLElement>('[data-slot="copy"]')!.dataset.copy = point.ref;
  } else dropRow(root, "ref");
  if (point.fractional)
    setSlot(root, "fractional", point.fractional.map((x) => formatDigits(x, FRACTIONAL_DIGITS)).join(", "));
  else dropRow(root, "fractional");
  setSlot(root, "cartesian", point.position.map((x) => formatDigits(x)).join(", "));
  if (hosts.length) {
    setSlot(root, "host", pointOf(hosts[0].center_point_id).element);
    setSlot(root, "neighbours", grouped(neighbours));
  } else dropRow(root, "neighbours");
  root.querySelector('[data-slot="view"]')!.append(cloneTemplate("center-button"));
  return root;
}

// The object the readout shows, for its Center button.
let shown: Target | null = null;

// Fills the readout for a pick (or shows the empty state for none).
export function describe(target: Target | null) {
  shown = target;
  if (!target) info.replaceChildren(cloneTemplate("nothing-selected"));
  else if (target.kind === "polyhedron") info.replaceChildren(polyhedronReadout(target.poly));
  else info.replaceChildren(atomReadout(target.atom));
}

// The Copy button in the readout copies the atom's reference and says so for a moment.
function copyRef(button: HTMLElement) {
  const done = (text: string) => {
    button.textContent = text;
    // the label goes back to "Copy" after a moment, so the button can be used again
    setTimeout(() => {
      button.textContent = "Copy";
    }, COPY_FEEDBACK_MS);
  };
  // writeText can throw synchronously (no clipboard in this context) as well as reject: both say Failed
  try {
    navigator.clipboard.writeText(button.dataset.copy ?? "").then(
      () => done("Copied"),
      () => done("Failed"),
    );
  } catch {
    done("Failed");
  }
}

export function wireReadout(): void {
  info.addEventListener("click", (e) => {
    const button = closestOf(e.target, "button[data-copy]");
    if (button) copyRef(button);
    else if (closestOf(e.target, "button[data-center]") && shown) {
      const { centre, size } = objectBounds(shown);
      centreOn(centre, size);
    }
  });
}
