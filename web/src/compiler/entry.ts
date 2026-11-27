// The compiler bundle (compile.js): reading a structure, the config and the compile. The viewer loads it on a page with a
// gemmy-compiler meta (scene/compiler.ts), and it registers the compiler under __gemmyCompiler (typed in globals.d.ts).
// No React, no three: the viewer reaches the compiler only through this object.
import defaults from "../../../configs/default.json";
import { type ColourScheme, elementTableOf } from "../compile/colour-schemes";
import { MapFileSource, type SidecarFile, pickConfig, sidecarKind } from "../compile/files";
import { loadSceneConfig, parseSceneConfig } from "../compile/config";
import { defaultBondRules } from "../compile/default-rules";
import { detectShapes } from "../compile/default-kind";
import { hideBondsCoveredByPolyhedra, hideCentresOfPolyhedra } from "../compile/config-edit-polyhedra";
import { compileScene } from "../compile/pipeline";
import { initStructureReader, readStructure } from "../structure/fastatoms";
import { neighborSource } from "../structure/neighbors";
import type { Structure } from "../structure/structure";

// The style of an element the table does not have (the dummy X): a neutral grey, at the viewer's default radius. The
// config's style lookup (styleFor) falls back to the "default" entry for it.
const UNKNOWN_ELEMENT_STYLE = { color: [0.5, 0.5, 0.5, 1.0], radius: 0.35 };

// The styles of the structure's labels under a colour scheme: each label gets its element's entry in the scheme (compile/
// colour-schemes.ts). A label whose element the table lacks gets the "default" entry instead, so the structure's dummy
// atoms still draw in grey.
function elementStylesOf(structure: Structure, scheme: ColourScheme): Record<string, unknown> {
  const table = elementTableOf(scheme);
  const styles: Record<string, unknown> = {};
  for (const atom of structure.atoms) {
    const label = atom.styleKey || atom.element;
    if (Object.hasOwn(table, atom.element)) styles[label] = table[atom.element];
    else styles.default = UNKNOWN_ELEMENT_STYLE;
  }
  return styles;
}

// The default config of a structure opened alone: configs/default.json (materials, cells, displacements) with the
// structure filled in, its periodic axes from the file (a POSCAR is periodic on all three, an extxyz or LAMMPS file on
// its pbc), the element styles of its elements, and bonds and shapes derived from the structure: the rules of its unit cell
// (one cell, so the neighbour search stays small). The shapes follow the kind of the structure (default-kind.ts): polyhedra
// for a crystal, rings for a molecule. The bonds and centres the polyhedra draw are hidden. A structure opened alone compiles
// with it; a dropped config replaces it whole (ui/structure-load.ts). The element styles and the colours of the automatic
// polyhedra and rings are the page's colour scheme.
export function defaultConfig(structureName: string, structure: Structure, scheme: ColourScheme) {
  const base = parseSceneConfig({
    ...defaults,
    structure: structureName,
    elements: elementStylesOf(structure, scheme),
  });
  const periodic = [structure.pbc[0], structure.pbc[1], structure.pbc[2]] as [boolean, boolean, boolean];
  const config = { ...base, cell: { ...base.cell, periodic } };
  const unitCell = neighborSource(structure, [1, 1, 1], periodic);
  const withBonds = { ...config, bonds: defaultBondRules(structure, unitCell) };
  const detected = detectShapes(structure, unitCell, withBonds, scheme);
  // Only the centres that get a polyhedron lose their bonds and their atoms: a centre whose ligands are collinear draws none.
  const shapes = { ...withBonds, polyhedra: detected.polyhedra, clusters: detected.rings };
  return hideCentresOfPolyhedra(hideBondsCoveredByPolyhedra(shapes, detected.emitted), detected.emitted);
}

// The files a compile names, by name: the dropped sidecars.
function fileSource(files: readonly SidecarFile[]): MapFileSource {
  return new MapFileSource(files);
}

const compiler = {
  ready: initStructureReader(),
  readStructure,
  neighborSource,
  loadSceneConfig,
  defaultConfig,
  compileScene,
  fileSource,
  pickConfig,
  sidecarKind,
};

// The type of the registered compiler, for the viewer. The viewer imports it as a type only, which is erased, so the
// page never runs this module: only the compile.js it loads does.
export type CompilerApi = typeof compiler;

globalThis.__gemmyCompiler = compiler;
