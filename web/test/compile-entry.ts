// The modules the node parity tests run (tests/ts_bundle.py bundles this file). The structure reader is the one part
// that loads the vendored fastatoms wasm (tests/ts_bundle.py bundles it in). A test job calls any export by name, so a
// new stage adds its helpers here, not in Python.
import { neighborSource } from "../src/structure/neighbors";
import type { NeighborSource, Structure } from "../src/structure/structure";
import type { Vec3 } from "../src/types";
import type { BondRule, ClusterRule, PolyhedronRule, SelectConfig } from "../src/compile/config";
import {
  type Neighbor,
  type NeighborGraph,
  buildNeighborGraph,
  closingBonds,
  completeLigand,
  completionRules,
  findBonds,
} from "../src/compile/bonds";
import { findPolyhedra } from "../src/compile/polyhedra";
import { applySelection, parseSiteRef, polyhedronShell, resolveCentre } from "../src/compile/selection";
import { type Cell, type Site, pointKey } from "../src/compile/sites";
import { type BoxRanges, snap } from "../src/compile/lattice";
import { applyLabels, loadLabelFile } from "../src/compile/labels";
import { baseBox, buildSites, nameMatches, selectSites, snapSites, wrapSites } from "../src/compile/sites";
import { CHEMICAL_SYMBOLS } from "../src/structure/elements";
import { type ReadStructureOptions, readStructure } from "../src/structure/fastatoms";
import { fileText } from "../src/scene/read";
import { defaultConfig } from "../src/compiler/entry";
import {
  COLOUR_SCHEME_OPTIONS,
  DEFAULT_COLOUR_SCHEME_CHOICE,
  type ColourScheme,
  type ColourSchemeChoice,
  elementTableOf,
} from "../src/compile/colour-schemes";
import {
  markAutomaticColours,
  markAutomaticPolyhedra,
  markAutomaticRings,
  automaticColoursOf,
  type StructureModel,
} from "../src/ui/structure-model";
import { storedChoice } from "../src/ui/colour-scheme";
import { switchColourScheme } from "../src/ui/colour-switch";
import { resolveTypes } from "../src/ui/type-resolution";
import {
  type Color,
  type MaterialStyle,
  type SceneConfig,
  loadSceneConfig,
  parseSceneConfig,
} from "../src/compile/config";
import { configToData, configToJson, configToToml, jsonText } from "../src/compile/config-export";
import { defaultBondRules } from "../src/compile/default-rules";
import { defaultPolyhedronRules } from "../src/compile/default-shapes";
import { defaultRingRules } from "../src/compile/default-rings";
import { detectShapes } from "../src/compile/default-kind";
import { schemeFor } from "../src/compile/structure-kind";
import { redetectShapes } from "../src/react/style-panel/shapes-nodes";
import { MaterialTable } from "../src/compile/materials";
import { MapFileSource, type SidecarFile } from "../src/compile/files";
import { compileScene } from "../src/compile/pipeline";
import { findClusters } from "../src/compile/clusters";
export { isFlatRing } from "../src/compile/clusters";

export * from "../src/structure/structure";
export * from "../src/structure/types";
export * from "../src/structure/elements";
export * from "../src/structure/readers";
export * from "../src/structure/fastatoms";
export * from "../src/compile/bonds";
export * from "../src/compile/hull";
export * from "../src/compile/polyhedra";
export * from "../src/compile/selection";
export * from "../src/compile/lattice";
export * from "../src/compile/sites";
export * from "../src/compile/labels";
export * from "../src/compile/displacements";
export * from "../src/compile/config";
export * from "../src/compile/materials";
export * from "../src/compile/files";

// Test-only: the text a config's name finds among the dropped files (null when none), or the error (the class and message).
export function sidecarText(files: SidecarFile[], name: string): string | null {
  return new MapFileSource(files).read(name) ?? null;
}
export * from "../src/structure/types";

// The colour scheme the fixtures below use when they need one: a registered id (web/src/compile/schemes/).
const VESTA = "vesta";

// Test-only (config): a config holds null for each unset key, and the runner refuses a null result, so configs come
// back as JSON text.
// Non-finite numbers (a TOML inf or nan) go out as the JSON tokens Python reads, since the runner refuses them as values.
export const parseSceneConfigJson = (raw: unknown): string => jsonText(parseSceneConfig(raw));
export const loadSceneConfigJson = (name: string, text: string): string => jsonText(loadSceneConfig(name, text));
// The TOML and JSON texts of a config, from its dict or its file's text (configToToml and configToJson, as the page exports).
export const exportConfigFromDict = (raw: unknown) => exportConfig(parseSceneConfig(raw));
export const exportConfigFromText = (name: string, text: string) => exportConfig(loadSceneConfig(name, text));
function exportConfig(config: SceneConfig) {
  return { toml: configToToml(config), json: configToJson(config) };
}

// Test-only (materials): resolve (base material, colour) pairs in order on one table, as the compile does.
export function materialSequence(base: Record<string, MaterialStyle>, pairs: [string, Color][]) {
  const table = new MaterialTable(base);
  const ids = pairs.map(([material, color]) => table.resolve(material, color));
  return { ids, materials: Object.fromEntries(table.materials) };
}

// The supercell and its neighbour pairs as plain arrays (typed arrays do not survive JSON), in the order the pairs
// come in. The Python side compares these with ASE's neighbor_list on the same supercell.
export function neighborSnapshot(
  structure: Structure,
  supercell: [number, number, number],
  periodic: [boolean, boolean, boolean],
  cutoff: number,
) {
  return neighborRows(neighborSource(structure, supercell, periodic), cutoff);
}

function neighborRows(source: NeighborSource, cutoff: number) {
  const pairs = source.neighbors(cutoff);
  const copy = (rows: readonly Vec3[]) => rows.map((row) => [row[0], row[1], row[2]]);
  return {
    cell: copy(source.cell),
    positions: copy(source.positions),
    scaled: copy(source.scaled),
    symbols: source.symbols,
    i: Array.from(pairs.i),
    j: Array.from(pairs.j),
    S: Array.from(pairs.S),
    d: Array.from(pairs.d),
  };
}

// Test-only: the source is built, then the caller's structure, supercell and periodic arrays are changed. The rows must
// still be those of the supercell built before the change (compare with neighborSnapshot on the unchanged input).
export function neighborSnapshotAfterMutation(
  structure: Structure,
  supercell: [number, number, number],
  periodic: [boolean, boolean, boolean],
  cutoff: number,
) {
  const cells: [number, number, number] = [...supercell];
  const flags: [boolean, boolean, boolean] = [...periodic];
  const source = neighborSource(structure, cells, flags);
  structure.atoms[0].fractional[0] += 0.3;
  structure.lattice[0][0] *= 2;
  structure.atoms.reverse();
  cells[0] = 1;
  flags[0] = !flags[0];
  return neighborRows(source, cutoff);
}

// Test-only: one value of each kind the page runner must reject or pass (tests/ts_bundle.py).
export function runnerValue(kind: string): unknown {
  switch (kind) {
    case "undefined":
      return undefined;
    case "nan":
      return { fractional: [0, Number.NaN, 0] };
    case "typed":
      return new Float64Array([1, 2]);
    case "null":
      return { ref: null, list: [null, 1] };
    default:
      throw new Error(`unknown runner value ${kind}`);
  }
}

// Bond, polyhedron and selection helpers for tests/test_ts_bonds.py. A Map and a list of Sites do not survive JSON,
// so each helper takes plain rows (sites as they are, the neighbour graph as [index, neighbours] rows) and returns
// plain rows. A point is named by its pointKey.
export type GraphRows = [number, Neighbor[]][];
export type BondRow = [string, string, number];

const graphOf = (rows: GraphRows): NeighborGraph => new Map(rows);
const byIndexOf = (sites: Site[]): Map<number, Site> => new Map(sites.map((site) => [site.index, site]));

export function neighborGraphRows(
  structure: Structure,
  supercell: [number, number, number],
  periodic: [boolean, boolean, boolean],
  cutoff: number,
): GraphRows {
  return [...buildNeighborGraph(neighborSource(structure, supercell, periodic), cutoff).entries()];
}

export function findBondRows(
  shown: Site[],
  base: Site[],
  graph: GraphRows,
  rules: BondRule[],
  cell: Cell,
  strict: boolean,
): BondRow[] {
  return findBonds(shown, byIndexOf(base), graphOf(graph), rules, cell, strict).map((spec) => [
    pointKey(spec.a),
    pointKey(spec.b),
    rules.indexOf(spec.rule),
  ]);
}

export function closingBondRows(
  shown: Site[],
  base: Site[],
  graph: GraphRows,
  rules: BondRule[],
  cell: Cell,
): BondRow[] {
  return closingBonds(shown, byIndexOf(base), graphOf(graph), rules, cell).map((spec) => [
    pointKey(spec.a),
    pointKey(spec.b),
    rules.indexOf(spec.rule),
  ]);
}

// Indices (into the bond rules) of the rules with complete: polyhedra.
export function completionRuleIndices(bondRules: BondRule[]): number[] {
  return completionRules(bondRules).map((rule) => bondRules.indexOf(rule));
}

// Completion of one ligand: [partner key, index of the bond rule] per completion.
export function completionRows(
  bondRules: BondRule[],
  ligand: Site,
  base: Site[],
  graph: GraphRows,
  cell: Cell,
): [string, number][] {
  return completeLigand(ligand, byIndexOf(base), graphOf(graph), completionRules(bondRules), cell).map((done) => [
    pointKey(done.partner),
    bondRules.indexOf(done.rule),
  ]);
}

// Polyhedra for the given centres: the centre key, ligand keys and positions in order, the name and the faces.
export function findPolyhedraRows(
  centers: Site[],
  base: Site[],
  graph: GraphRows,
  rules: PolyhedronRule[],
  cell: Cell,
) {
  return findPolyhedra(centers, byIndexOf(base), graphOf(graph), rules, cell).map((spec) => ({
    centre: pointKey(spec.center),
    ligands: spec.ligands.map(pointKey),
    ligandPositions: spec.ligands.map((ligand) => ligand.position),
    name: spec.name,
    faces: spec.faces,
  }));
}

export function applySelectionKeys(
  shown: Site[],
  select: SelectConfig,
  base: Site[],
  graph: GraphRows,
  rules: PolyhedronRule[],
  cell: Cell,
): string[] {
  return applySelection(shown, select, byIndexOf(base), graphOf(graph), rules, cell).map(pointKey);
}

// The centre a ref names and its polyhedron ligands (keys).
export function polyhedronShellKeys(
  ref: number | string,
  shown: Site[],
  base: Site[],
  graph: GraphRows,
  rules: PolyhedronRule[],
  cell: Cell,
): [string, string[]] {
  const [centre, ligands] = polyhedronShell(ref, shown, byIndexOf(base), graphOf(graph), rules, cell);
  return [pointKey(centre), ligands.map(pointKey)];
}

export function resolveCentreKey(ref: number | string, shown: Site[], base: Site[], cell: Cell): string {
  return pointKey(resolveCentre(ref, shown, byIndexOf(base), cell));
}

// parseSiteRef with its null shift written as [] (the runner refuses a null result).
export function parseSiteRefRows(ref: number | string): [number, number[]] {
  const [index, shift] = parseSiteRef(ref);
  return [index, shift ?? []];
}

// Test-only: JSON has no null for the runner to pass (it rejects one), so "nothing moves" and "no score" are outcomes.
export function snapOutcome(fractional: Vec3, position: Vec3, cell: Cell, eps: number) {
  const moved = snap(fractional, position, cell, eps);
  return moved === null ? { moved: false } : { moved: true, fractional: moved.fractional, position: moved.position };
}

export function nameMatchesOutcome(name: string, site: Site) {
  return { matched: nameMatches(name, site) };
}

// Test-only: the site stages in compile_structure's order (snap, wrap, display box, limits) on a structure text. `cells`
// is the config's cells table as JSON gives it: its defaults and the `limits` alias are read here, as config does.
export function siteStages(text: string, fileName: string, cells: Record<string, unknown>, labelText: string | null) {
  const { structure } = readStructure(text, { fileName });
  const supercell = (cells.supercell ?? [1, 1, 1]) as [number, number, number];
  const periodic = (cells.periodic ?? [false, false, false]) as [boolean, boolean, boolean];
  const eps = (cells.eps ?? 1e-4) as number;
  const box = (cells.box ?? {}) as BoxRanges;
  const limits = (cells.limits ?? cells.cartesian_limits ?? null) as BoxRanges | null;
  const labels = labelText === null ? {} : loadLabelFile("labels.json", labelText);
  const source = neighborSource(structure, supercell, periodic);
  const cell = source.cell;
  const built = applyLabels(buildSites(structure, source), labels, structure.atoms.length);
  const snapped = snapSites(built, cell, eps);
  const wrapped = wrapSites(snapped, cell, periodic);
  const boxed = baseBox(wrapped, cell, box, periodic, eps);
  return { built, snapped, wrapped, boxed, selected: selectSites(boxed, limits) };
}

// Test-only (pipeline): a structure and a config, read as the page reads them, compiled to a scene. `sidecars` holds the
// files the config names (name -> text). The scene is what compileScene returns; `warnings` are what the stages raised.
export function compileFixture(
  structureName: string,
  structureText: string,
  configName: string,
  configText: string,
  sidecars: Record<string, string>,
): { scene: unknown; warnings: string[] } {
  const config = loadSceneConfig(configName, configText);
  const { structure } = readStructure(structureText, { fileName: structureName, configTypes: config.types });
  const source = neighborSource(structure, config.cell.supercell, config.cell.periodic);
  const warnings: string[] = [];
  const scene = compileScene(structure, source, config, new MapFileSource(sidecars), warnings);
  return { scene, warnings };
}

// Test-only (type-resolution): the card's type resolution for a structure with a dropped config. A config's map is strict,
// so its error is the card's message: the call throws it, and returns null when the types resolve.
export function resolveConfigTypes(structureName: string, structureText: string, types: Record<string, string>): null {
  resolveTypes({ readStructure }, structureText, structureName, { config: types, page: undefined }, true);
  return null;
}

// Test-only (default rules): the bond rules a structure gets with no config, derived as the page derives them: from the
// supercell and periodic flags of the default config (`defaultsText`, configs/default.json). Returns the elements of the
// atoms, the rules, the rules as configToData writes them (after parseSceneConfig, so they are validated), and the
// default config with these bonds in place of its own, as the JSON text Export writes.
export function defaultRulesFixture(structureName: string, structureText: string, defaultsText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const defaults = loadSceneConfig("default.json", defaultsText);
  const source = neighborSource(structure, defaults.cell.supercell, defaults.cell.periodic);
  const rules = defaultBondRules(structure, source);
  return {
    elements: structure.atoms.map((atom) => atom.element),
    rules,
    exportedRules: configToData(parseSceneConfig({ bonds: rules })).bonds,
    json: configToJson({ ...defaults, bonds: rules }),
  };
}

// The warnings findPolyhedra pushes (a centre whose ligands have no hull), for tests/test_ts_bonds.py.
export function findPolyhedraWarnings(
  centers: Site[],
  base: Site[],
  graph: GraphRows,
  rules: PolyhedronRule[],
  cell: Cell,
): string[] {
  const warnings: string[] = [];
  findPolyhedra(centers, byIndexOf(base), graphOf(graph), rules, cell, warnings);
  return warnings;
}

// Test-only (export): the TOML text of a config file's text, and its JSON text. The JSON export of a non-finite number
// is a ConfigError, so that job reports the error instead of a text.
export const exportTomlFromText = (name: string, text: string): string => configToToml(loadSceneConfig(name, text));
export const exportJsonFromText = (name: string, text: string): string => configToJson(loadSceneConfig(name, text));

// Test-only (materials): the material id of each element style of a config file's text, resolved in order as the
// compile does. The text is read here, so a JSON -0 or a TOML -0.0 reaches the table as the page reads it.
export function elementMaterialsFromText(name: string, text: string) {
  const config = loadSceneConfig(name, text);
  const table = new MaterialTable(config.materials);
  const ids = Object.values(config.elements).map((style) => table.resolve(style.material, style.color));
  return { ids, materials: Object.fromEntries(table.materials) };
}
// The clusters of a structure text as plain rows, for tests/test_ts_clusters.py: the display-box sites (siteStages),
// the neighbour graph (cutoff: the largest rule max_distance, or 0) and findClusters, with the warnings it gives. `cells`
// is the cells table as JSON gives it (supercell, periodic, eps, box). Each cluster: member point keys in order,
// centroid, centroidFractional, faces, name, and the index of its rule.
export function clusterRows(text: string, fileName: string, cells: Record<string, unknown>, rules: ClusterRule[]) {
  const { structure } = readStructure(text, { fileName });
  const supercell = (cells.supercell ?? [1, 1, 1]) as [number, number, number];
  const periodic = (cells.periodic ?? [false, false, false]) as [boolean, boolean, boolean];
  const eps = (cells.eps ?? 1e-4) as number;
  const box = (cells.box ?? {}) as BoxRanges;
  const source = neighborSource(structure, supercell, periodic);
  const stages = siteStages(text, fileName, cells, null);
  const cutoff = Math.max(0, ...rules.map((rule) => rule.max_distance));
  const graph = buildNeighborGraph(source, cutoff);
  const byIndex = new Map(stages.snapped.map((site) => [site.index, site]));
  const warnings: string[] = [];
  const found = findClusters(stages.boxed, byIndex, graph, rules, source.cell, box, periodic, eps, warnings);
  const clusters = found.map((spec) => ({
    members: spec.members.map((site) => pointKey(site)),
    centroid: spec.centroid,
    centroidFractional: spec.centroidFractional,
    faces: spec.faces,
    name: spec.name,
    rule: rules.indexOf(spec.rule),
  }));
  return { clusters, warnings };
}

// Test-only (elements): the symbols the label rule knows, in atomic-number order (ASE's chemical_symbols).
export const chemicalSymbols = (): string[] => [...CHEMICAL_SYMBOLS];

// --- stage 6 edits ---
// Test-only (config-edit, pair-distances): the style panel's edits and its structure facts, for tests/test_ts_config_edit.py
// and tests/test_ts_pair_distances.py. The concept files' exports are re-exported here, and the rows below are plain data.
import * as bondEdits from "../src/compile/config-edit-bonds";
import * as cellEdits from "../src/compile/config-edit-cell";
import * as clusterEdits from "../src/compile/config-edit-clusters";
import * as elementEdits from "../src/compile/config-edit-elements";
import * as polyhedronEdits from "../src/compile/config-edit-polyhedra";
import { pairDistances, presentNames } from "../src/compile/pair-distances";

export * from "../src/compile/config-edit-bonds";
export * from "../src/compile/config-edit-cell";
export * from "../src/compile/config-edit-clusters";
export * from "../src/compile/config-edit-elements";
export * from "../src/compile/config-edit-polyhedra";
export * from "../src/compile/pair-distances";

type Edit = (config: SceneConfig, ...args: unknown[]) => SceneConfig;

// The concept files whose exports are edits, searched in turn for an edit's name.
const EDIT_MODULES: Record<string, unknown>[] = [bondEdits, cellEdits, clusterEdits, elementEdits, polyhedronEdits];

// One edit of a config, by its export's name in its concept file. An unknown name is a bug in the test, not a config error.
function applyEdit(config: SceneConfig, name: string, args: unknown[]): SceneConfig {
  const module = EDIT_MODULES.find((candidate) => Object.hasOwn(candidate, name));
  if (module === undefined) throw new Error(`no config edit named ${name}`);
  const edit = module[name] as Edit;
  return edit(config, ...args);
}

// Test-only (config-edit): the config of a dict, then the steps [edit name, arguments] in order. Returns the edited
// config, the file form the export writes (configToData), both as JSON text, and whether the input config was left as it
// was (an edit must not change its argument). A refused step is the ConfigError the edit threw.
export function editConfig(raw: unknown, steps: [string, unknown[]][]) {
  const input = parseSceneConfig(raw);
  const inputBefore = jsonText(input);
  const edited = steps.reduce((config, [name, args]) => applyEdit(config, name, args), input);
  return {
    config: jsonText(edited),
    data: jsonText(configToData(edited)),
    inputUnchanged: jsonText(input) === inputBefore,
  };
}

// Test-only (pair-distances): the distances of each element pair of a structure text, on a supercell with these periodic
// flags, up to the cutoff. A Map does not survive JSON, so it comes back as an object.
export function pairDistanceRows(
  text: string,
  fileName: string,
  cutoff: number,
  supercell: [number, number, number],
  periodic: [boolean, boolean, boolean],
): Record<string, number[]> {
  return pairDistanceRead(text, fileName, cutoff, supercell, periodic).distances;
}

// Test-only (pair-distances): the same read with its partial flag, for the budget tests.
export function pairDistanceRead(
  text: string,
  fileName: string,
  cutoff: number,
  supercell: [number, number, number],
  periodic: [boolean, boolean, boolean],
): { distances: Record<string, number[]>; partial: boolean } {
  const { structure } = readStructure(text, { fileName });
  const read = pairDistances(neighborSource(structure, supercell, periodic), cutoff);
  return { distances: Object.fromEntries(read.distances), partial: read.partial };
}

// Test-only (pair-distances): the labels and elements of a structure text (presentNames).
export function presentNamesOf(text: string, fileName: string): string[] {
  return presentNames(readStructure(text, { fileName }).structure);
}

// --- end stage 6 edits ---

// Test-only (detection): the bond rules detection makes of a structure with these options (tolerance, metalPairs), on the
// unit cell of the defaults. The rules are parsed, as the page holds them.
export function detectedRulesFixture(
  structureName: string,
  structureText: string,
  defaultsText: string,
  tolerance: number,
  metalPairs: boolean,
) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const defaults = loadSceneConfig("default.json", defaultsText);
  const source = neighborSource(structure, defaults.cell.supercell, defaults.cell.periodic);
  return defaultBondRules(structure, source, { tolerance, metalPairs });
}

// Test-only (default config): the cell a structure opened alone gets (compiler/entry.ts defaultConfig): its supercell and
// periodic flags, how many bonds it derives, and the config's file form (`data`) for the edit tests.
// Test-only (default-shapes): the default polyhedron rules of a structure text, on its unit cell (defaultConfig's cell).
export function defaultPolyhedraFixture(structureName: string, structureText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  return defaultPolyhedronRules(structure, neighborSource(structure, [1, 1, 1], periodic), {}, VESTA);
}

// Test-only (default rings): the ring rules detection makes of a structure text, on its unit cell (defaultConfig's cell).
export function defaultRingsFixture(structureName: string, structureText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  return defaultRingRules(structure, neighborSource(structure, [1, 1, 1], periodic), {}, VESTA);
}

// Test-only (large inputs): the default bonds, polyhedra and rings of a structure text, as counts with the time each
// stage took, so a large structure comes back small.
export function detectDefaultsTimed(structureName: string, structureText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const source = neighborSource(structure, [1, 1, 1], periodic);
  const stage = <T>(run: () => T) => {
    const started = performance.now();
    const value = run();
    return { value, ms: Math.round(performance.now() - started) };
  };
  const bonds = stage(() => defaultBondRules(structure, source));
  const polyhedra = stage(() => defaultPolyhedronRules(structure, source, {}, VESTA));
  const rings = stage(() => defaultRingRules(structure, source, {}, VESTA));
  return {
    bonds: bonds.value.length,
    centres: polyhedra.value.map((rule) => rule.center),
    rings: rings.value.length,
    ms: { bonds: bonds.ms, polyhedra: polyhedra.ms, rings: rings.ms },
  };
}

// Test-only (automatic rings): a structure opened alone, its automatic rings cleared or re-detected. Returns the ring rules
// after the edit (`rings`, by name), and the file form after a second re-detect (`again`).
export function automaticRingsFixture(structureName: string, structureText: string, action: "clear" | "redetect") {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, VESTA);
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const detected = detectShapes(structure, neighborSource(structure, [1, 1, 1], periodic), config, VESTA);
  const owned = config.clusters.map(clusterEdits.ringKeyOf).filter((key) => key !== "");
  const edit = (current: SceneConfig) =>
    action === "clear"
      ? clusterEdits.clearAutomaticRings(current, owned)
      : clusterEdits.replaceAutomaticRings(current, owned, detected.rings);
  const once = edit(config);
  const again = edit(once);
  return { rings: once.clusters.map((rule) => rule.name), data: configToData(once), again: configToData(again) };
}

// Test-only (automatic rings): a structure opened alone with a ring of the user's added, then its automatic rings re-detected
// and cleared. Returns the ring names after each edit: the user's ring survives both.
export function userRingFixture(structureName: string, structureText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, VESTA);
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const detected = detectShapes(structure, neighborSource(structure, [1, 1, 1], periodic), config, VESTA);
  const [user] = parseSceneConfig({
    clusters: [
      { kind: "ring", atoms: ["C"], min_distance: 1.2, max_distance: 1.6, min_size: 6, max_size: 6, name: "mine" },
    ],
  }).clusters;
  const withUser = { ...config, clusters: [...config.clusters, user] };
  const owned = config.clusters.map(clusterEdits.ringKeyOf).filter((key) => key !== "");
  const names = (current: SceneConfig) => current.clusters.map((rule) => rule.name);
  return {
    before: names(withUser),
    redetected: names(clusterEdits.replaceAutomaticRings(withUser, owned, detected.rings)),
    cleared: names(clusterEdits.clearAutomaticRings(withUser, owned)),
  };
}

// Test-only (centre atoms): a structure opened alone, its automatic polyhedra cleared or re-detected. Returns each element's
// visibility after the edit (`visible`), the config's file form (`data`), and the file form after a second re-detect (`again`).
export function automaticCentresFixture(structureName: string, structureText: string, action: "clear" | "redetect") {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, VESTA);
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const detected = detectShapes(structure, neighborSource(structure, [1, 1, 1], periodic), config, VESTA);
  const owned = config.polyhedra.map((rule) => rule.center);
  const edit = (current: SceneConfig) =>
    action === "clear"
      ? polyhedronEdits.clearAutomaticPolyhedra(current, owned)
      : polyhedronEdits.replaceAutomaticPolyhedra(current, owned, detected.polyhedra, detected.emitted);
  const once = edit(config);
  const again = edit(once);
  return {
    visible: Object.fromEntries(Object.entries(once.elements).map(([element, style]) => [element, style.visible])),
    data: configToData(once),
    again: configToData(again),
  };
}

// Test-only (Re-detect): a structure opened alone, with each centre element in `colours` given that colour (its element
// style), then its automatic polyhedra Re-detected. Returns the colours the polyhedra had before (the default config's)
// and the config's file form (`data`) after.
export function redetectedPolyhedraFixture(
  structureName: string,
  structureText: string,
  colours: Record<string, Color>,
) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, VESTA);
  const elements = { ...config.elements };
  for (const [element, color] of Object.entries(colours)) elements[element] = { ...elements[element], color };
  const styled = { ...config, elements };
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const detected = detectShapes(structure, neighborSource(structure, [1, 1, 1], periodic), styled, VESTA);
  const owned = config.polyhedra.map((rule) => rule.center);
  const redetected = polyhedronEdits.replaceAutomaticPolyhedra(styled, owned, detected.polyhedra, detected.emitted);
  return {
    before: config.polyhedra.map((rule) => rule.color),
    after: redetected.polyhedra.map((rule) => rule.color),
    data: configToData(redetected),
  };
}

// Test-only (Re-detect): a structure opened alone, its automatic polyhedra and rings Re-detected as the Shapes panel does
// (redetectShapes, with the detection of the unit cell). Returns the automatic centres and ring patterns after the edit
// (`centres`, `patterns`) and the config's file form (`data`).
export function redetectShapesFixture(structureName: string, structureText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, VESTA);
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const detected = detectShapes(structure, neighborSource(structure, [1, 1, 1], periodic), config, VESTA);
  const automatic = new Set(config.polyhedra.map((rule) => rule.center));
  const automaticRings = new Set(config.clusters.map(clusterEdits.ringKeyOf).filter((key) => key !== ""));
  const next = redetectShapes(config, automatic, automaticRings, detected);
  return { centres: [...automatic], patterns: [...automaticRings], data: configToData(next) };
}

export function defaultConfigFixture(structureName: string, structureText: string) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, VESTA);
  return {
    supercell: config.cell.supercell,
    periodic: config.cell.periodic,
    bonds: config.bonds.map((rule) => [rule.a, rule.b]),
    polyhedra: config.polyhedra.length,
    elements: config.elements,
    data: configToData(config),
  };
}

// Test-only (colour schemes): a structure opened alone under `scheme`, its automatic elements, polyhedra and rings marked
// as the page marks them. `handSet` gives elements a colour of the user's first (and takes them out of the automatic set,
// as the Colour control does). Then the scheme is switched to `next`. Returns each element's colour, and the colours of the
// polyhedra and rings, before the switch (`before`) and after it (`after`).
export function colourSchemeFixture(
  structureName: string,
  structureText: string,
  scheme: ColourSchemeChoice,
  next: ColourSchemeChoice,
  handSet: Record<string, Color> = {},
) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  let config = defaultConfig(structureName, structure, schemeFor(structure, scheme));
  const neighbors = neighborSource(structure, config.cell.supercell, config.cell.periodic);
  // Only the structure and its neighbours are read here (the page's model holds more); the marks are keyed by the object.
  const model = { structure, neighbors } as unknown as StructureModel;
  markAutomaticColours(model, Object.keys(config.elements));
  markAutomaticPolyhedra(model, config.polyhedra);
  markAutomaticRings(model, config.clusters);
  for (const [element, color] of Object.entries(handSet)) {
    config = elementEdits.setElementColor(config, element, color);
    automaticColoursOf(model).delete(element);
  }
  const colourMaps = (current: SceneConfig) => ({
    elements: Object.fromEntries(Object.entries(current.elements).map(([element, style]) => [element, style.color])),
    polyhedra: Object.fromEntries(current.polyhedra.map((rule) => [rule.center, rule.color])),
    rings: Object.fromEntries(current.clusters.map((rule) => [rule.name, rule.color])),
  });
  const before = colourMaps(config);
  const after = colourMaps(switchColourScheme(model, config, next));
  return { before, after };
}

// Test-only (colour schemes): the options the dropdown lists, and the default choice.
export function colourSchemesFixture() {
  return { options: COLOUR_SCHEME_OPTIONS.map((option) => ({ ...option })), default: DEFAULT_COLOUR_SCHEME_CHOICE };
}

// Test-only (colour schemes): the choice a stored value gives (ui/colour-scheme.ts), null being nothing stored.
export function storedChoiceFixture(raw: string | null) {
  return storedChoice(raw);
}

// Test-only (colour schemes): a structure opened alone under a choice, its element colours (the default config's).
export function defaultColoursFixture(structureName: string, structureText: string, choice: ColourSchemeChoice) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  const config = defaultConfig(structureName, structure, schemeFor(structure, choice));
  return Object.fromEntries(Object.entries(config.elements).map(([element, style]) => [element, style.color]));
}

// Test-only (colour schemes): a structure opened alone under Auto, switched to `next` and back to Auto, with the hand-set
// colours kept (as colourSchemeFixture marks them). Returns the element and polyhedron colours after each step.
export function colourRoundTripFixture(
  structureName: string,
  structureText: string,
  next: ColourSchemeChoice,
  handSet: Record<string, Color> = {},
) {
  const { structure } = readStructure(structureText, { fileName: structureName });
  let config = defaultConfig(structureName, structure, schemeFor(structure, "auto"));
  const neighbors = neighborSource(structure, config.cell.supercell, config.cell.periodic);
  const model = { structure, neighbors } as unknown as StructureModel;
  markAutomaticColours(model, Object.keys(config.elements));
  markAutomaticPolyhedra(model, config.polyhedra);
  markAutomaticRings(model, config.clusters);
  for (const [element, color] of Object.entries(handSet)) {
    config = elementEdits.setElementColor(config, element, color);
    automaticColoursOf(model).delete(element);
  }
  const colourMaps = (current: SceneConfig) => ({
    elements: Object.fromEntries(Object.entries(current.elements).map(([element, style]) => [element, style.color])),
    polyhedra: Object.fromEntries(current.polyhedra.map((rule) => [rule.center, rule.color])),
  });
  const start = colourMaps(config);
  const switched = switchColourScheme(model, config, next);
  const back = switchColourScheme(model, switched, "auto");
  return { start, switched: colourMaps(switched), back: colourMaps(back) };
}

// Test-only (colour schemes): each element's colour under a scheme, for the symbols asked (an element the scheme lacks is
// left out).
export function schemeColoursFixture(scheme: ColourScheme, symbols: string[]) {
  const table = elementTableOf(scheme);
  return Object.fromEntries(
    symbols.filter((symbol) => Object.hasOwn(table, symbol)).map((symbol) => [symbol, table[symbol].color]),
  );
}

// Test-only (the reader contract): a structure file's bytes as the page reads them. fileText gunzips by the magic bytes
// (never by the name), then readStructure reads the text. `base64` is the file's raw bytes.
export async function readStructureFromBase64(base64: string, options: ReadStructureOptions) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return readStructure(await fileText(bytes), options);
}
