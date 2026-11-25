// The geometry readout: the details panel's text for the selected atom or polyhedron (distances, the distortion, the
// fractional and Cartesian positions), the Copy button that takes an atom's reference, and the Center button that frames
// the shown object as Fit frames the structure.
import * as THREE from "three";
import { centre as structureCentre, points, polyhedra, type Target } from "../state";
import { centreOn } from "../camera/view";
import type { AtomPrimitive, Point, PolyhedronPrimitive, Vec3 } from "../types";
import { byId, closestOf } from "./dom";

const info = byId("info-body");
const ANGSTROM_DIGITS = 3;
const FRACTIONAL_DIGITS = 4;
const DELTA_SCALE = 1e4; // the distortion is shown in units of 10^-4
const COPY_FEEDBACK_MS = 1500;
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// The distance between two points, in the scene's units (angstroms).
export function dist(a: Vec3, b: Vec3): number {
  return new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
}

function pointOf(id: string): Point {
  const point = points.get(id);
  if (!point) throw new Error(`gemmy viewer: the scene has no point ${id}`);
  return point;
}
function fmt(x: number, digits = ANGSTROM_DIGITS): string {
  return x.toFixed(digits);
}
function average(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
// Digits as subscripts, so a polyhedron named "Si6" reads Si₆.
function subscripts(s: string): string {
  return s.replace(/\d+/g, (m) => [...m].map((c) => SUBSCRIPT_DIGITS[Number(c)]).join(""));
}
// Equal distances written once with a count: "2 × 1.970, 2.011".
function grouped(values: number[]): string {
  const counts = new Map<string, number>();
  for (const x of values) counts.set(fmt(x), (counts.get(fmt(x)) || 0) + 1);
  return [...counts]
    .sort((p, q) => Number(p[0]) - Number(q[0]))
    .map(([x, n]) => (n > 1 ? `${n} × ${x}` : x))
    .join(", ");
}

function nothingSelectedHtml(): string {
  return `<h2>Nothing selected</h2><p class="hint">Click an atom or a polyhedron to see its distances.</p>`;
}
function polyhedronHtml(p: PolyhedronPrimitive): string {
  const centre = pointOf(p.center_point_id);
  const bonds = p.ligand_point_ids.map((id) => dist(centre.position, pointOf(id).position));
  const mean = average(bonds);
  const distortion = average(bonds.map((x) => ((x - mean) / mean) ** 2));
  const centreText = centre.fractional
    ? `${centre.element} at (${centre.fractional.map((x) => fmt(x, FRACTIONAL_DIGITS)).join(", ")})`
    : centre.element;
  return `<h2>${escapeHtml(subscripts(p.name ?? "Polyhedron"))}</h2><dl>
      <dt>Centre</dt><dd>${escapeHtml(centreText)}</dd>
      <dt>Bonds</dt><dd>${grouped(bonds)} Å</dd>
      <dt>Mean</dt><dd>${fmt(mean)} Å</dd>
      <dt>Δ</dt><dd>${(distortion * DELTA_SCALE).toFixed(2)} × 10⁻⁴</dd>
      <dt>View</dt><dd>${CENTER_BUTTON}</dd></dl>
      <p class="hint">Δ is the bond-length distortion, the mean of ((d − d̄)/d̄)². Fractional coordinates are in the supercell.</p>`;
}
// The Center button's framing: the object's centre and size in scene units (the origin is the structure's middle). An
// atom's size is its diameter; a polyhedron's is the diagonal of the box round its corners, and its centre the box's.
function objectBounds(target: Target): { centre: THREE.Vector3; size: number } {
  const offset = new THREE.Vector3(...structureCentre);
  if (target.kind === "atom") {
    const position = new THREE.Vector3(...pointOf(target.atom.point_id).position).sub(offset);
    return { centre: position, size: 2 * target.atom.radius };
  }
  const corners = target.poly.ligand_point_ids.map((id) => new THREE.Vector3(...pointOf(id).position));
  const low = new THREE.Vector3(Infinity, Infinity, Infinity), high = low.clone().multiplyScalar(-1);
  for (const c of corners) { low.min(c); high.max(c); }
  return { centre: low.clone().add(high).multiplyScalar(0.5).sub(offset), size: low.distanceTo(high) };
}
// The button in the readout that centres the view on the shown object (the same framing as Fit, glided to).
const CENTER_BUTTON = `<button type="button" class="copy" data-center title="Center and fit this object" aria-label="Center and fit this object"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg> Center</button>`;

function atomHtml(a: AtomPrimitive): string {
  const point = pointOf(a.point_id);
  const hosts = polyhedra.filter((p) => p.ligand_point_ids.includes(a.point_id));
  const neighbours = hosts.map((p) => dist(point.position, pointOf(p.center_point_id).position));
  const hostElement = hosts.length ? pointOf(hosts[0].center_point_id).element : "";
  const ref = point.ref
    ? `<dt>Ref</dt><dd>${escapeHtml(point.ref)} <button type="button" class="copy" data-copy="${escapeHtml(point.ref)}">Copy</button></dd>`
    : "";
  const fractional = point.fractional
    ? `<dt>Fractional</dt><dd>${point.fractional.map((x) => fmt(x, FRACTIONAL_DIGITS)).join(", ")}</dd>`
    : "";
  const nbrs = neighbours.length ? `<dt>${escapeHtml(hostElement)} nbrs</dt><dd>${grouped(neighbours)} Å</dd>` : "";
  return `<h2>${escapeHtml(point.element)} atom</h2><dl>
      ${ref}
      ${fractional}
      <dt>Cartesian</dt><dd>${point.position.map((x) => fmt(x)).join(", ")} Å</dd>
      ${nbrs}
      <dt>View</dt><dd>${CENTER_BUTTON}</dd></dl>
      <p class="hint">Fractional coordinates are in the supercell.</p>`;
}

// The object the readout shows, for its Center button.
let shown: Target | null = null;

// Fills the readout for a pick (or shows the empty state for none).
export function describe(target: Target | null) {
  shown = target;
  if (!target) info.innerHTML = nothingSelectedHtml();
  else if (target.kind === "polyhedron") info.innerHTML = polyhedronHtml(target.poly);
  else info.innerHTML = atomHtml(target.atom);
}

// The Copy button in the readout copies the atom's reference and says so for a moment.
function copyRef(button: HTMLElement) {
  const done = (text: string) => {
    button.textContent = text;
    // the label goes back to "Copy" after a moment, so the button can be used again
    setTimeout(() => { button.textContent = "Copy"; }, COPY_FEEDBACK_MS);
  };
  // writeText can throw synchronously (no clipboard in this context) as well as reject: both say Failed
  try {
    navigator.clipboard.writeText(button.dataset.copy ?? "").then(() => done("Copied"), () => done("Failed"));
  } catch {
    done("Failed");
  }
}
info.addEventListener("click", (e) => {
  const button = closestOf(e.target, "button[data-copy]");
  if (button) copyRef(button);
  else if (closestOf(e.target, "button[data-center]") && shown) {
    const { centre, size } = objectBounds(shown);
    centreOn(centre, size);
  }
});
