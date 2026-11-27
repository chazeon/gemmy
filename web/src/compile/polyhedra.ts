// Coordination polyhedra: which centres get one, their ligand images and hull faces (compile/polyhedra.py).
import { type NeighborGraph, siteAt } from "./bonds";
import type { PolyhedronRule } from "./config";
import { convexHullFaces, isPlanar, MIN_POLYGON_CORNERS, type Triangle } from "./hull";
import { type Cell, type PointKey, type Site, addShifts, image, pointKey } from "./sites";

export interface PolyhedronSpec {
  center: Site;
  ligands: Site[]; // periodic images
  faces: Triangle[];
  rule: PolyhedronRule;
  name: string;
}

// Visible rules whose centre is this site's species label.
export function rulesForCenter(rules: PolyhedronRule[], center: Site): PolyhedronRule[] {
  return rules.filter((rule) => rule.visible && rule.center === center.label);
}

export function isLigand(rule: PolyhedronRule, site: Site): boolean {
  return rule.ligands.includes(site.label);
}

// The name of a rule's polyhedron: its own name, or the default `<center><ligands><count>` when it has none. An empty
// name takes the default. Same as polyhedron_name in compile/polyhedra.py.
function polyhedronName(rule: PolyhedronRule, cn: number): string {
  return rule.name || `${rule.center}${[...rule.ligands].sort().join("")}${cn}`;
}

// Why a centre has no polyhedron: its ligands have no hull. Same text as compile/polyhedra.py skipped_message.
export function skippedMessage(center: Site, rule: PolyhedronRule, cn: number): string {
  const name = polyhedronName(rule, cn);
  const shiftText = `(${center.shift.join(", ")})`;
  // Two or more ligands without a hull must lie on one line; fewer than two cannot make one.
  const reason = cn >= 2 ? "its ligands are collinear" : `it has only ${cn} ligand(s)`;
  return (
    `polyhedron ${name} skipped for centre ${center.label} (atom ${center.index}, image ${shiftText}): ${reason}, ` +
    `so there is no polygon to draw (a polygon needs ${MIN_POLYGON_CORNERS} ligands that are not on one line)`
  );
}

// A flat polygon has no inside: each triangle is drawn once from each side (the opposite winding), so the renderers,
// which cull back faces, show it from either side.
export function withBackFaces(faces: Triangle[]): Triangle[] {
  return [...faces, ...faces.map(([i, j, k]): Triangle => [i, k, j])];
}

// Polyhedra for the centres that meet their rule's coordination. A centre whose ligands have no hull (on a line, or
// fewer than 3) is skipped, and a message naming it is pushed to `warnings` when given.
export function findPolyhedra(
  centers: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: PolyhedronRule[],
  cell: Cell,
  warnings?: string[],
): PolyhedronSpec[] {
  const out: PolyhedronSpec[] = [];
  for (const center of centers) {
    for (const rule of rulesForCenter(rules, center)) {
      if (center.copy && !rule.image_centers) continue;
      const ligands: Site[] = [];
      const seen = new Set<PointKey>();
      for (const nb of graph.get(center.index) ?? []) {
        if (!(rule.min_distance <= nb.distance && nb.distance <= rule.max_distance)) continue;
        const base = siteAt(byIndex, nb.index);
        if (!isLigand(rule, base)) continue;
        const ligand = image(base, addShifts(center.shift, nb.shift), cell);
        const key = pointKey(ligand);
        if (seen.has(key)) continue;
        seen.add(key);
        ligands.push(ligand);
      }
      const cn = ligands.length;
      if (cn < rule.min_coordination || (rule.max_coordination !== null && cn > rule.max_coordination)) continue;
      const name = polyhedronName(rule, cn);
      const positions = ligands.map((ligand) => ligand.position);
      let faces = convexHullFaces(positions);
      if (faces.length === 0) {
        warnings?.push(skippedMessage(center, rule, cn));
        continue;
      }
      if (isPlanar(positions)) faces = withBackFaces(faces);
      out.push({ center, ligands, faces, rule, name });
    }
  }
  return out;
}
