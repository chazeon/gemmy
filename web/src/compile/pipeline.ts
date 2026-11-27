// The compile pipeline: structure + config -> the scene JSON that gemmy.config.scene_to_dict writes
// (compile/pipeline.py). The stages run in the order written out in compileStructure; the order is the output.
import type { AtomPrimitive, BondPrimitive, DisplacementPrimitive, PolyhedronPrimitive, Scene, Vec3 } from "../types";
import type { NeighborSource, Structure } from "../structure/structure";
import { type BondRule, type Color, type SceneConfig, displacementRefs, highlightRefs, selectIsActive } from "./config";
import { type ClusterSpec, findClusters } from "./clusters";
import {
  type BondSpec,
  type NeighborGraph,
  buildNeighborGraph,
  closingBonds,
  completeLigand,
  completionRules,
  findBonds,
} from "./bonds";
import {
  type ArrowSpec,
  DisplacementFileError,
  type VectorMap,
  loadDisplacementFile,
  makeDisplacements,
} from "./displacements";
import { type FileSource, requireFile } from "./files";
import { type LabelMap, applyLabels, labelerUnsupported, loadLabelFile } from "./labels";
import { cellBox } from "./lattice";
import { MaterialTable, ghostColor, isHidden, styleFor, visibleSites } from "./materials";
import { type PolyhedronSpec, findPolyhedra } from "./polyhedra";
import { applySelection, polyhedronShell, resolveCentre } from "./selection";
import {
  type Cell,
  type PointKey,
  type Shift,
  type Site,
  baseBox,
  buildSites,
  pointKey,
  selectSites,
  siteRef,
  snapSites,
  wrapSites,
} from "./sites";

// gemmy.scene.SCENE_SCHEMA_VERSION: the version the page's viewer reads.
export const SCENE_SCHEMA_VERSION = 3;
// Mirrored in src/gemmy/compile/pipeline.py (DISPLACEMENT_RADIUS, DISPLACEMENT_COLOR): change both together.
const DISPLACEMENT_RADIUS = 0.022;
const DISPLACEMENT_COLOR: [number, number, number, number] = [0.15, 0.18, 0.22, 1.0];
// Arrows take the bond material style as their base.
const ARROW_MATERIAL = "bond";
// The per_frame_topology key of the one frame a topology-locked polyhedron has.
const FIRST_FRAME = "0";
// The topology mode of a polyhedron that keeps its faces across frames (config.PolyhedronRule.topology_mode's default).
const TOPOLOGY_LOCKED = "topology_locked";
// The neighbour lists are strict (ASE and fastatoms return distances below the cutoff), but the rules match inclusively
// (min <= d <= max). The search radius is wider than the longest max by this relative margin, so a neighbour exactly at
// a rule's max is found; the rules still compare exactly. Mirrored in src/gemmy/compile/pipeline.py.
const NEIGHBOR_CUTOFF_MARGIN = 1e-9;
// The element of a computed point (a cluster centroid, which no atom is). Mirrored in src/gemmy/compile/pipeline.py
// (COMPUTED_ELEMENT).
const COMPUTED_ELEMENT = "X";

type Material = Scene["materials"][string];
type Point = Scene["points"][number];
type Topology = Scene["topologies"][number];

// How a polyhedron or a cluster is drawn: its material name, its colour and its topology mode.
interface SolidStyle {
  material: string;
  color: Color;
  topologyMode: string;
}

// A bond to add: its two point ids, the rule that styles it, and the element and label at each end.
interface BondToAdd {
  aPoint: string;
  bPoint: string;
  rule: BondRule;
  aElement: string;
  bElement: string;
  aLabel: string;
  bLabel: string;
}

// The sites that get arrows. `inwardFrom` is one polyhedron's centre when its arrows are tested inward
// (`displacements.inward = "outside"`), else null.
interface ArrowGroup {
  sites: Site[];
  inwardFrom: Vec3 | null;
}

// pipeline.compile_scene: loads the files the config names, then compiles. A file the config names and `files`
// does not hold is a MissingFileError.
export function compileScene(
  structure: Structure,
  source: NeighborSource,
  config: SceneConfig,
  files: FileSource,
  warnings?: string[],
): Scene {
  const vectors = loadVectors(config, files);
  const labels = loadLabels(config, files);
  return compileStructure(structure, source, config, vectors, labels, warnings);
}

// pipeline.compile_structure: the stages in their fixed order, with the displacement vectors and label overrides
// already loaded (`labels`: source index -> label). `warnings` collects the messages the stages raise without
// failing; Python surfaces the same messages with warnings.warn.
export function compileStructure(
  structure: Structure,
  source: NeighborSource,
  config: SceneConfig,
  displacements?: VectorMap,
  labels?: LabelMap,
  warnings: string[] = [],
): Scene {
  const cell: Cell = source.cell;
  const periodic = config.cell.periodic;
  const eps = config.cell.eps;
  const labelled = applyLabels(buildSites(structure, source), labels ?? {}, structure.atoms.length);
  const baseSites = snapSites(labelled, cell, eps);
  const byIndex = new Map(baseSites.map((site) => [site.index, site] as const)); // unshifted, snapped origins
  const wrapped = wrapSites(baseSites, cell, periodic);
  const inBox = selectSites(baseBox(wrapped, cell, config.cell.box, periodic, eps), config.cell.cartesian_limits);

  const graph = buildNeighborGraph(source, bondCutoff(config));
  const shown = applySelection(inBox, config.select, byIndex, graph, config.polyhedra, cell);

  const markedCentres = highlightRefs(config.highlight).map((ref) => resolveCentre(ref, shown, byIndex, cell));
  const marked = new Set(markedCentres.map(pointKey));
  const specs = polyhedraToShow(shown, markedCentres, byIndex, graph, config, cell, warnings);
  const asm = new SceneAssembler(config, new Map(wrapped.map((site) => [site.index, site.shift] as const)));
  for (const site of shown) asm.addSite(site);
  addClusters(asm, shown, byIndex, graph, config, cell, specs, marked, warnings);

  const bondRules = config.bonds;
  for (const bond of findBonds(shown, byIndex, graph, bondRules, cell, selectIsActive(config.select))) {
    asm.addSite(bond.a);
    asm.addSite(bond.b);
    asm.addBondSpec(bond);
  }

  addPolyhedra(asm, specs, marked, byIndex, graph, config, cell);

  if (config.displacements.enabled) {
    const arrows = displacementArrows(
      asm,
      config,
      displacements ?? {},
      structure.atoms.length,
      shown,
      byIndex,
      graph,
      cell,
    );
    asm.addArrows(arrows);
  }

  // Last, once every shown point exists (polyhedron ligands and displacement corners): every bond between two
  // shown points, whatever its `complete` mode. Adds bonds only, never atoms.
  for (const bond of closingBonds([...asm.drawn.values()], byIndex, graph, bondRules, cell)) {
    asm.addBondSpec(bond);
  }

  const { origin: boxOrigin, vectors: boxVectors } = cellBox(cell, config.cell.box);
  return {
    source_comment: structure.comment,
    materials: Object.fromEntries(asm.materials.materials) as Record<string, Material>,
    points: asm.points.records,
    topologies: asm.topologies,
    primitives: {
      atoms: asm.atoms,
      bonds: asm.bonds,
      polyhedra: asm.polyhedra,
      displacements: asm.displacements,
    },
    cell: { origin: boxOrigin, vectors: boxVectors },
    schema_version: SCENE_SCHEMA_VERSION,
  };
}

// The displacement vectors the config's data file names, or undefined when displacements are off.
function loadVectors(config: SceneConfig, files: FileSource): VectorMap | undefined {
  if (!config.displacements.enabled) return undefined;
  const dataFile = config.displacements.data_file;
  if (!dataFile) throw new DisplacementFileError("displacements are enabled but displacements.data_file is not set");
  return loadDisplacementFile(dataFile, requireFile(files, dataFile, "displacement file"));
}

// Label overrides from the label file. A labeler is an error in the browser.
function loadLabels(config: SceneConfig, files: FileSource): Record<number, string> {
  const labels: Record<number, string> = {};
  if (config.labels.file) {
    Object.assign(labels, loadLabelFile(config.labels.file, requireFile(files, config.labels.file, "label file")));
  }
  if (config.labels.labeler) labelerUnsupported(config.labels.labeler);
  return labels;
}

// The neighbour search radius: the longest visible bond, polyhedron or cluster rule, widened by NEIGHBOR_CUTOFF_MARGIN
// (0 when there is none). Every rule's max_distance is finite (config.ts), so the radius is too.
function bondCutoff(config: SceneConfig): number {
  const bondReach = Math.max(0, ...config.bonds.filter((rule) => rule.visible).map((rule) => rule.max_distance));
  const polyhedronReach = Math.max(
    0,
    ...config.polyhedra.filter((rule) => rule.visible).map((rule) => rule.max_distance),
  );
  const clusterReach = Math.max(0, ...config.clusters.filter((rule) => rule.visible).map((rule) => rule.max_distance));
  return Math.max(bondReach, polyhedronReach, clusterReach) * (1 + NEIGHBOR_CUTOFF_MARGIN);
}

// A polyhedron per shown centre, plus one per highlighted centre outside the box. Skipped centres add a message to
// `warnings`.
function polyhedraToShow(
  shown: Site[],
  markedCentres: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  config: SceneConfig,
  cell: Cell,
  warnings: string[],
): PolyhedronSpec[] {
  const specs = findPolyhedra(shown, byIndex, graph, config.polyhedra, cell, warnings);
  const foundCentreKeys = new Set(specs.map((spec) => pointKey(spec.center)));
  // e.g. an image centre outside the box
  const missing = markedCentres.filter((centre) => !foundCentreKeys.has(pointKey(centre)));
  if (missing.length === 0) return specs;
  return specs.concat(findPolyhedra(missing, byIndex, graph, config.polyhedra, cell, warnings));
}

// Each cluster, in order: its members (atoms, as polyhedron ligands are), its centroid as a computed point, then the
// polyhedron. A ring's faces index its members and then the centroid, so the centroid is a ring's last ligand. A
// cluster with no faces adds a message to `warnings`. A cluster whose members are exactly the ligands of a polyhedron
// is skipped with a message: the polyhedron is drawn in its place (its centre is the more specific choice). With
// highlighted centres, a cluster is a ghost unless one of its members is one of them (as a polyhedron is, by its centre).
function addClusters(
  asm: SceneAssembler,
  shown: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  config: SceneConfig,
  cell: Cell,
  polyhedra: PolyhedronSpec[],
  marked: Set<PointKey>,
  warnings: string[],
): void {
  const specs = findClusters(
    shown,
    byIndex,
    graph,
    config.clusters,
    cell,
    config.cell.box,
    config.cell.periodic,
    config.cell.eps,
    warnings,
  );
  const polyhedronByLigands = new Map(polyhedra.map((p) => [setKey(p.ligands.map(pointKey)), p] as const));
  for (const spec of specs) {
    const twin = polyhedronByLigands.get(setKey(spec.members.map(pointKey)));
    if (twin !== undefined) {
      warnings.push(
        `cluster ${spec.name} skipped: its members are exactly the ligands of polyhedron ${twin.name}, which is ` +
          "drawn in their place (the polyhedron wins: its centre is the more specific choice)",
      );
      continue;
    }
    const members = spec.members.map((site) => asm.addSite(site));
    const centroid = asm.points.addComputed(spec.centroid, spec.centroidFractional);
    const ligands = spec.rule.kind === "ring" ? [...members, centroid] : members;
    const isGhost = marked.size > 0 && !spec.members.some((site) => marked.has(pointKey(site)));
    asm.addCluster(spec, centroid, ligands, isGhost);
  }
}

// The identity of a set of point keys, as one string: sorted, so the same set gives the same key in any order.
function setKey(keys: string[]): string {
  return [...new Set(keys)].sort().join("|");
}

// Each polyhedron, in order: its centre, its ligands, the bonds that complete each ligand, then the polyhedron. It
// is a ghost when some centre is highlighted and this one is not.
function addPolyhedra(
  asm: SceneAssembler,
  specs: PolyhedronSpec[],
  marked: Set<PointKey>,
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  config: SceneConfig,
  cell: Cell,
): void {
  const secondaryRules = completionRules(config.bonds);
  for (const spec of specs) {
    const centerPoint = asm.addSite(spec.center);
    const ligandPoints: string[] = [];
    for (const ligand of spec.ligands) {
      const ligandPoint = asm.addSite(ligand);
      ligandPoints.push(ligandPoint);
      for (const done of completeLigand(ligand, byIndex, graph, secondaryRules, cell)) {
        const partnerPoint = asm.addSite(done.partner);
        asm.addBond({
          aPoint: ligandPoint,
          bPoint: partnerPoint,
          rule: done.rule,
          aElement: ligand.element,
          bElement: done.partner.element,
          aLabel: ligand.label,
          bLabel: done.partner.label,
        });
      }
    }
    const ghost = marked.size > 0 && !marked.has(pointKey(spec.center));
    asm.addPolyhedron(spec, centerPoint, ligandPoints, ghost);
  }
}

// The arrows for the displacement settings. The corners of each ref's polyhedron get their points; with no refs,
// every drawn site gets an arrow.
function displacementArrows(
  asm: SceneAssembler,
  config: SceneConfig,
  vectors: VectorMap,
  atomCount: number,
  shown: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  cell: Cell,
): ArrowSpec[] {
  const disp = config.displacements;
  const ownRefs = displacementRefs(disp);
  const refs = ownRefs.length > 0 ? ownRefs : highlightRefs(config.highlight);
  const groups: ArrowGroup[] = [];
  for (const ref of refs) {
    const [centre, corners] = polyhedronShell(ref, shown, byIndex, graph, config.polyhedra, cell);
    for (const site of corners) asm.addSite(site);
    groups.push({ sites: corners, inwardFrom: disp.inward === "outside" ? centre.position : null });
  }
  if (refs.length === 0) groups.push({ sites: [...asm.drawn.values()], inwardFrom: null });
  const arrows: ArrowSpec[] = [];
  for (const group of groups) {
    const sites = disp.include_hidden ? group.sites : visibleSites(config, group.sites);
    for (const arrow of makeDisplacements(sites, vectors, atomCount, disp.scale, disp.style, group.inwardFrom)) {
      arrows.push(arrow);
    }
  }
  return arrows;
}

// Point ids, one per (base atom, image shift) identity, in first-seen order (pipeline.PointTable).
export class PointTable {
  readonly records: Point[] = [];
  // Atom points, keyed by pointKey ("index:a,b,c"). Computed points have no key (nothing looks them up).
  private readonly ids = new Map<string, string>();
  // wrapShifts: atom index -> the shift that wrapped it into the cell (its references are relative to that).
  constructor(private readonly wrapShifts: ReadonlyMap<number, Shift> = new Map()) {}

  // A point that is no atom (a cluster centroid): never shown, no reference.
  addComputed(position: Vec3, fractional: Vec3): string {
    const pointId = `p${this.records.length}`;
    this.records.push({
      id: pointId,
      element: COMPUTED_ELEMENT,
      label: COMPUTED_ELEMENT,
      position,
      fractional,
      ref: null,
    });
    return pointId;
  }

  idFor(site: Site): string {
    const key = pointKey(site);
    const found = this.ids.get(key);
    if (found !== undefined) return found;
    const pointId = `p${this.records.length}`;
    this.records.push({
      id: pointId,
      element: site.element,
      label: site.label,
      position: site.position,
      fractional: site.fractional,
      ref: siteRef(site, this.wrapShifts.get(site.index) ?? [0, 0, 0]),
    });
    this.ids.set(key, pointId);
    return pointId;
  }
}

// The primitives and topologies a scene collects, with the dedup rules of pipeline.SceneAssembler.
export class SceneAssembler {
  readonly points: PointTable;
  readonly materials: MaterialTable;
  readonly atoms: AtomPrimitive[] = [];
  readonly bonds: BondPrimitive[] = [];
  readonly polyhedra: PolyhedronPrimitive[] = [];
  readonly displacements: DisplacementPrimitive[] = [];
  readonly topologies: Topology[] = [];
  // Every site that gets a point, in first-seen order (arrows follow images).
  readonly drawn = new Map<string, Site>();
  private readonly atomPoints = new Set<string>();
  private readonly bondPairs = new Set<string>();
  private readonly topologyIds = new Map<string, string>();

  constructor(
    private readonly config: SceneConfig,
    wrapShifts?: ReadonlyMap<number, Shift>,
  ) {
    this.points = new PointTable(wrapShifts);
    this.materials = new MaterialTable(config.materials);
  }

  // addAtom, and remember the site as drawn.
  addSite(site: Site): string {
    const point = this.addAtom(site);
    if (!this.drawn.has(point)) this.drawn.set(point, site);
    return point;
  }

  // Register the point and (unless hidden or already emitted) its atom primitive.
  addAtom(site: Site): string {
    const pointId = this.points.idFor(site);
    const style = styleFor(this.config, site);
    if (this.atomPoints.has(pointId) || isHidden(style)) return pointId;
    this.atoms.push({
      id: `atom_${this.atoms.length}_${site.element}`,
      element: site.element,
      label: site.label,
      point_id: pointId,
      radius: style.radius,
      material_id: this.materials.resolve(style.material, style.color),
    });
    this.atomPoints.add(pointId);
    return pointId;
  }

  addBond(bond: BondToAdd): void {
    const key = pairKey(bond.aPoint, bond.bPoint);
    if (this.bondPairs.has(key)) return;
    this.bonds.push({
      id: `bond_${this.bonds.length}_${bond.rule.a}_${bond.rule.b}`,
      a_point_id: bond.aPoint,
      b_point_id: bond.bPoint,
      radius: bond.rule.radius,
      material_id: this.materials.resolve(bond.rule.material, bond.rule.color),
      a_element: bond.aElement,
      b_element: bond.bElement,
      a_label: bond.aLabel,
      b_label: bond.bLabel,
      style: bond.rule.style,
    });
    this.bondPairs.add(key);
  }

  addBondSpec(bond: BondSpec): void {
    // Evaluated left to right, as in Python, so new points are numbered in that order.
    const a = this.points.idFor(bond.a);
    const b = this.points.idFor(bond.b);
    this.addBond({
      aPoint: a,
      bPoint: b,
      rule: bond.rule,
      aElement: bond.a.element,
      bElement: bond.b.element,
      aLabel: bond.a.label,
      bLabel: bond.b.label,
    });
  }

  addTopology(pointIds: string[], faces: [number, number, number][]): string {
    const key = JSON.stringify([pointIds, faces]);
    const found = this.topologyIds.get(key);
    if (found !== undefined) return found;
    const id = `topo_${this.topologies.length}`;
    this.topologies.push({ id, point_ids: [...pointIds], faces: copyFaces(faces) });
    this.topologyIds.set(key, id);
    return id;
  }

  addPolyhedron(spec: PolyhedronSpec, centerPoint: string, ligandPoints: string[], ghost = false): void {
    const rule = spec.rule;
    const style: SolidStyle = { material: rule.material, color: rule.color, topologyMode: rule.topology_mode };
    this.addSolid(spec.name, spec.faces, style, centerPoint, ligandPoints, ghost);
  }

  // A cluster is drawn as a polyhedron, locked to its one topology: its faces index its members (a ring's centroid
  // comes last).
  addCluster(spec: ClusterSpec, centerPoint: string, ligandPoints: string[], ghost = false): void {
    const style: SolidStyle = { material: spec.rule.material, color: spec.rule.color, topologyMode: TOPOLOGY_LOCKED };
    this.addSolid(spec.name, spec.faces, style, centerPoint, ligandPoints, ghost);
  }

  private addSolid(
    name: string,
    faces: [number, number, number][],
    style: SolidStyle,
    centerPoint: string,
    ligandPoints: string[],
    ghost: boolean,
  ): void {
    const topologyId = this.addTopology(ligandPoints, faces);
    this.polyhedra.push({
      id: `poly_${this.polyhedra.length}_${name}`,
      name,
      center_point_id: centerPoint,
      ligand_point_ids: [...ligandPoints],
      topology_id: topologyId,
      topology_mode: style.topologyMode as PolyhedronPrimitive["topology_mode"],
      material_id: this.materials.resolve(style.material, this.polyhedronColor(style.color, ghost)),
      per_frame_topology: style.topologyMode === TOPOLOGY_LOCKED ? { [FIRST_FRAME]: topologyId } : null,
    });
  }

  // The colour. A ghost keeps it, lightened, at the highlight's opacity.
  private polyhedronColor(color: Color, ghost: boolean) {
    if (!ghost) return color;
    const hl = this.config.highlight;
    return ghostColor(color, hl.ghost_opacity, hl.ghost_saturation, hl.ghost_value);
  }

  // Arrows share one material. It is resolved even with no arrows, so the material table lists it.
  addArrows(arrows: ArrowSpec[]): void {
    const materialId = this.materials.resolve(ARROW_MATERIAL, DISPLACEMENT_COLOR);
    for (const arrow of arrows) {
      this.displacements.push({
        id: `disp_${this.displacements.length}`,
        start_point_id: this.points.idFor(arrow.site),
        vector: arrow.vector,
        mode: arrow.mode,
        anchor: arrow.anchor,
        radius: DISPLACEMENT_RADIUS,
        material_id: materialId,
      });
    }
  }
}

// The identity of an unordered pair of point ids, as one string (pipeline.SceneAssembler keys a sorted tuple).
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// A copy of the faces, so the scene does not share the spec's arrays.
function copyFaces(faces: [number, number, number][]): Topology["faces"] {
  return faces.map((face): [number, number, number] => [...face]);
}
