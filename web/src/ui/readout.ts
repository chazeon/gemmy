// The geometry readout: the details panel's text for the selected atom or polyhedron (distances, the distortion, the
// fractional and Cartesian positions), and the Copy button that takes an atom's reference.
import * as THREE from "three";
import { points, polyhedra, type Target } from "../state";
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
      <dt>Δ</dt><dd>${(distortion * DELTA_SCALE).toFixed(2)} × 10⁻⁴</dd></dl>
      <p class="hint">Δ is the bond-length distortion, the mean of ((d − d̄)/d̄)². Fractional coordinates are in the supercell.</p>`;
}
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
      ${nbrs}</dl>
      <p class="hint">Fractional coordinates are in the supercell.</p>`;
}

// Fills the readout for a pick (or shows the empty state for none).
export function describe(target: Target | null) {
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
});
