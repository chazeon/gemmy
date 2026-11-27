// Selection: restrict the base set by label, index or polyhedron shell (compile/selection.py).
import type { SelectConfig, PolyhedronRule } from "./config";
import { type NeighborGraph, siteAt } from "./bonds";
import { findPolyhedra } from "./polyhedra";
import { type Cell, type PointKey, type Shift, type Site, nameMatches, pointKey, translate } from "./sites";

// The select block refers to an atom that does not exist.
export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

// Python int() on a whole string: optional sign, digits (underscores allowed between digits), surrounding space.
const PY_INT = /^\s*[+-]?\d(?:_?\d)*\s*$/;

function pyInt(text: string): number {
  if (!PY_INT.test(text)) throw new SelectionError("not an integer");
  return Number(text.replace(/_/g, ""));
}

// Python repr() of a str, for the error text.
function pyRepr(text: string): string {
  if (text.includes("'") && !text.includes('"')) return `"${text}"`;
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// `5` -> [5, null]; `"5+1_0_-1"` -> [5, [1, 0, -1]]: atom 5's image shifted by whole lattice vectors.
export function parseSiteRef(ref: number | string): [number, Shift | null] {
  if (typeof ref === "number") return [ref, null];
  const plus = ref.indexOf("+");
  const head = plus < 0 ? ref : ref.slice(0, plus);
  try {
    const index = pyInt(head);
    if (plus < 0) return [index, null];
    const parts = ref.slice(plus + 1).split("_");
    if (parts.length !== 3) throw new SelectionError("needs three shifts");
    return [index, [pyInt(parts[0]), pyInt(parts[1]), pyInt(parts[2])]];
  } catch {
    throw new SelectionError(`bad atom reference ${pyRepr(ref)}; use an index like 5 or an image like '5+1_0_0'`);
  }
}

// The atom `ref` names. It is the atom as placed in the cell (wrapped, not a boundary copy); a shift in `ref` moves
// it by whole lattice vectors from there.
export function resolveCentre(ref: number | string, shown: Site[], byIndex: Map<number, Site>, cell: Cell): Site {
  const [index, shift] = parseSiteRef(ref);
  if (!byIndex.has(index)) {
    throw new SelectionError(`atom ${index} does not exist; the structure has ${byIndex.size} atoms`);
  }
  const centre = shown.find((site) => site.index === index && !site.copy) ?? siteAt(byIndex, index);
  return shift === null ? centre : translate(centre, shift, cell);
}

// The centre `ref` names (see resolveCentre) and its polyhedron ligands.
export function polyhedronShell(
  ref: number | string,
  shown: Site[],
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: PolyhedronRule[],
  cell: Cell,
): [Site, Site[]] {
  const centre = resolveCentre(ref, shown, byIndex, cell);
  const ligands: Site[] = [];
  const seen = new Set<PointKey>();
  for (const spec of findPolyhedra([centre], byIndex, graph, rules, cell)) {
    for (const site of spec.ligands) {
      if (!seen.has(pointKey(site))) {
        seen.add(pointKey(site));
        ligands.push(site);
      }
    }
  }
  return [centre, ligands];
}

// Keep the sites matching `labels` or `indices` (all box copies), plus the exact shell of `shell_of`. A shell is the
// centre and the ligand images of its polyhedra, so only that one polyhedron's atoms are added. An empty selection
// returns `shown` unchanged.
export function applySelection(
  shown: Site[],
  select: SelectConfig,
  byIndex: Map<number, Site>,
  graph: NeighborGraph,
  rules: PolyhedronRule[],
  cell: Cell,
): Site[] {
  const hasShell = select.shell_of !== null && select.shell_of !== undefined;
  if (select.labels.length === 0 && select.indices.length === 0 && !hasShell) return shown;
  for (const index of select.indices) {
    if (!byIndex.has(index)) {
      throw new SelectionError(`select refers to atom ${index}, but the structure has ${byIndex.size} atoms`);
    }
  }
  const wanted = new Set(select.indices);
  const kept = shown.filter(
    (site) => wanted.has(site.index) || select.labels.some((label) => nameMatches(label, site)),
  );
  if (hasShell) {
    const [centre, ligands] = polyhedronShell(select.shell_of as number | string, shown, byIndex, graph, rules, cell);
    const have = new Set(kept.map(pointKey));
    for (const site of [centre, ...ligands]) {
      if (!have.has(pointKey(site))) kept.push(site);
    }
  }
  return kept;
}
