// The default shapes of a structure opened without a config, by the owner's rule: "rings for a molecule, polyhedra for a
// crystal". The kind is read from the file's periodicity (its pbc), so a crystal's polyhedra and a molecule's rings are the
// only automatic shapes. Detection and the defaults both go through here, so Re-detect follows the same rule.
import type { ClusterRule, PolyhedronRule, SceneConfig } from "./config";
import type { ColourScheme } from "./colour-schemes";
import { structureKindOf } from "./structure-kind";
import { defaultPolyhedronRules } from "./default-shapes";
import { defaultRingRules } from "./default-rings";
import { compileStructure } from "./pipeline";
import type { NeighborSource, Structure } from "../structure/structure";
import type { Scene } from "../types";

// The automatic shapes of one kind: the polyhedra of a crystal, or the rings of a molecule, and none of the other.
export interface DefaultShapes {
  polyhedra: PolyhedronRule[];
  rings: ClusterRule[];
}

// The default shapes of a structure (see structureKindOf): `styles` are the config's element styles, `scheme` the colour scheme.
export function defaultShapesOf(
  structure: Structure,
  source: NeighborSource,
  styles: SceneConfig["elements"],
  scheme: ColourScheme,
): DefaultShapes {
  if (structureKindOf(structure) === "crystal") {
    return { polyhedra: defaultPolyhedronRules(structure, source, styles, scheme), rings: [] };
  }
  return { polyhedra: [], rings: defaultRingRules(structure, source, styles, scheme) };
}

// What detection makes for a structure, with `emitted`: the centre labels whose polyhedra a compile of the config draws.
// A centre whose ligands are collinear has a rule but draws no polyhedron (polyhedra.ts), so its atoms and bonds stay shown.
export interface DetectedShapes extends DefaultShapes {
  emitted: string[];
}

// The shapes detection makes for `config` (its bonds, elements and rules are the base the compile runs on).
export function detectShapes(
  structure: Structure,
  source: NeighborSource,
  config: SceneConfig,
  scheme: ColourScheme,
): DetectedShapes {
  const shapes = defaultShapesOf(structure, source, config.elements, scheme);
  const compiled = { ...config, polyhedra: shapes.polyhedra, clusters: shapes.rings };
  return { ...shapes, emitted: emittedCentresOf(compileStructure(structure, source, compiled)) };
}

// The centre labels of the polyhedra a compile draws (one per polyhedron primitive, its centre point's label).
function emittedCentresOf(scene: Scene): string[] {
  const labelOf = new Map(scene.points.map((point) => [point.id, point.label] as const));
  return scene.primitives.polyhedra.map((polyhedron) => labelOf.get(polyhedron.center_point_id) ?? "");
}
