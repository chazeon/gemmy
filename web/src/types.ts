// The scene document as the viewer reads it: the JSON scene_to_dict writes (src/gemmy/scene.py). The JSON has every
// key, including the ones scene.py gives a default, so those are required here too; `| null` is a Python None.
export type Vec3 = [number, number, number];
export type Color = [number, number, number, number];
type BondStyle = "solid" | "dashed" | "dotted";
type DisplacementMode = "arrow" | "line";
type ArrowAnchor = "tail" | "tip";
type TopologyMode = "topology_locked" | "topology_adaptive";

export interface Material {
  type: string;
  base_color: Color;
  roughness: number;
  metallic: number;
  alpha: number;
}

export interface Point {
  id: string;
  element: string;
  label: string;
  position: Vec3;
  fractional: Vec3 | null;
  ref: string | null;
}

export interface Topology {
  id: string;
  point_ids: string[];
  faces: [number, number, number][];
}

export interface AtomPrimitive {
  id: string;
  element: string;
  label: string;
  point_id: string;
  radius: number;
  material_id: string;
}

export interface BondPrimitive {
  id: string;
  a_point_id: string;
  b_point_id: string;
  radius: number;
  material_id: string;
  a_element: string;
  b_element: string;
  a_label: string;
  b_label: string;
  style: BondStyle;
}

export interface PolyhedronPrimitive {
  id: string;
  name: string;
  center_point_id: string;
  ligand_point_ids: string[];
  topology_id: string;
  topology_mode: TopologyMode;
  material_id: string;
  per_frame_topology: Record<string, string> | null;
}

export interface DisplacementPrimitive {
  id: string;
  start_point_id: string;
  vector: Vec3;
  mode: DisplacementMode;
  anchor: ArrowAnchor;
  radius: number;
  material_id: string;
}

interface Primitives {
  atoms: AtomPrimitive[];
  bonds: BondPrimitive[];
  polyhedra: PolyhedronPrimitive[];
  displacements: DisplacementPrimitive[];
}

export interface Cell {
  origin: Vec3;
  vectors: [Vec3, Vec3, Vec3];
}

export interface Scene {
  source_comment: string;
  materials: Record<string, Material>;
  points: Point[];
  topologies: Topology[];
  primitives: Primitives;
  cell: Cell | null;
  schema_version: number;
}

// The numbers gemmy.view puts in the page (gemmy.view.render_constants).
export interface Constants {
  sceneSchemaVersion: number; // the scene format this viewer reads (scene.py SCENE_SCHEMA_VERSION)
  distanceFactor: number;
  distanceMin: number;
  orthoFactor: number;
  orthoMin: number;
  sensorWidth: number;
  lenses: number[];
  defaultLens: number;
  triad: {
    size: number;
    margin: number;
    arrowRadius: number;
    labelPad: number;
    labelSize: number;
    labelReach: number;
    headRadiusRatio: number;
    headLengthRatio: number;
    dotRadius: number;
    depthFadeMax: number;
  };
}
