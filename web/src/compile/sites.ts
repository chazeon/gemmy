// Sites: one atom position each (compile/sites.py). Images keep the atom's index and carry the integer lattice shift.
import type { Vec3 } from "../types";
import type { NeighborSource, Structure } from "../structure/structure";
import {
  type BoxRanges,
  boxImageCount,
  boxShifts,
  checkBoxSites,
  offset,
  snap,
  withinLimits,
  wrapShift,
} from "./lattice";

export type Shift = [number, number, number];
export type Cell = [Vec3, Vec3, Vec3]; // rows are lattice vectors

export interface Site {
  index: number; // the supercell atom index; images keep it and set `shift`
  element: string;
  label: string; // POSCAR species label, sidecar or labeler; defaults to the element
  fractional: Vec3;
  position: Vec3;
  shift: Shift;
  copy: boolean; // an extra boundary copy made by the display box
}

// The identity of a point: (base atom index, integer image shift), as one string so it can key a Map or a Set.
// The single place identity is defined.
export type PointKey = string;

export function pointKey(site: Pick<Site, "index" | "shift">): PointKey {
  return `${site.index}:${site.shift.join(",")}`;
}

export function addShifts(a: Shift, b: Shift): Shift {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sameShift(a: Shift, b: Shift): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function isZeroShift(shift: Shift): boolean {
  return sameShift(shift, [0, 0, 0]);
}

// Site.image: this atom moved by an integer lattice shift, relative to the unshifted atom.
export function image(site: Site, shift: Shift, cell: Cell): Site {
  return { ...site, ...offset(site.position, site.fractional, shift, cell), shift: [shift[0], shift[1], shift[2]] };
}

// Site.translate: this site moved by a further integer lattice shift (shifts accumulate).
export function translate(site: Site, shift: Shift, cell: Cell): Site {
  return { ...site, ...offset(site.position, site.fractional, shift, cell), shift: addShifts(site.shift, shift) };
}

// sites.build_sites: one site per supercell atom, from the neighbour source's atoms. The label is the structure's
// style key for the atom's base index (i % base count), or the element when there is no style key.
export function buildSites(structure: Structure, source: NeighborSource): Site[] {
  const keys = structure.atoms.map((atom) => atom.styleKey || atom.element);
  return source.symbols.map((element, i) => ({
    index: i,
    element,
    label: keys.length > 0 ? keys[i % keys.length] : element,
    fractional: [source.scaled[i][0], source.scaled[i][1], source.scaled[i][2]],
    position: [source.positions[i][0], source.positions[i][1], source.positions[i][2]],
    shift: [0, 0, 0],
    copy: false,
  }));
}

// sites.snap_sites: pull coordinates within eps of an integer onto it, so a structure written either way is the
// same site.
export function snapSites(sites: Site[], cell: Cell, eps: number): Site[] {
  return sites.map((site) => {
    const snapped = snap(site.fractional, site.position, cell, eps);
    return snapped === null ? site : { ...site, fractional: snapped.fractional, position: snapped.position };
  });
}

// sites.wrap_sites: translate each (already snapped) site into [0, 1) on periodic axes. Identity stays (index, shift).
export function wrapSites(sites: Site[], cell: Cell, periodic: readonly [boolean, boolean, boolean]): Site[] {
  return sites.map((site) => {
    const shift = wrapShift(site.fractional, periodic);
    return shift.some((n) => n !== 0) ? image(site, shift, cell) : site;
  });
}

// sites.base_box: sites in the display box (fractional range per axis, default [0, 1], inclusive with eps). A periodic
// atom on a box face is shown on both faces, on an edge 4 times, at a corner 8 times. Copies keep the atom's index.
export function baseBox(
  sites: Site[],
  cell: Cell,
  box: BoxRanges,
  periodic: readonly [boolean, boolean, boolean],
  eps: number,
): Site[] {
  // The copies of every site are counted before any is made: a box too large for the page is refused here.
  const copies = sites.reduce((sum, site) => sum + boxImageCount(site.fractional, box, periodic, eps), 0);
  checkBoxSites(copies, sites.length);
  const out: Site[] = [];
  for (const site of sites) {
    for (const n of boxShifts(site.fractional, box, periodic, eps)) {
      out.push(n.some((k) => k !== 0) ? { ...translate(site, n, cell), copy: true } : site);
    }
  }
  return out;
}

// sites.select_sites: keep the sites inside the cartesian limits (all of them when there are no limits).
export function selectSites(sites: Site[], limits: BoxRanges | null | undefined): Site[] {
  return sites.filter((site) => withinLimits(site.position, limits));
}

// sites.site_ref: the atom reference of a site, as parse_site_ref reads it. `wrapShift` is the shift that put the
// atom in the cell; references are relative to that wrapped position, not the raw one.
export function siteRef(site: Site, wrapShift: Shift): string {
  const shiftFromWrapped = [site.shift[0] - wrapShift[0], site.shift[1] - wrapShift[1], site.shift[2] - wrapShift[2]];
  return shiftFromWrapped.some((n) => n !== 0) ? `${site.index}+${shiftFromWrapped.join("_")}` : String(site.index);
}

// sites.name_matches: whether a name (a rule's or a selection's) is this site's species label. Labels only: `C`
// does not match `C_dna`.
export function nameMatches(name: string, site: Site): boolean {
  return name === site.label;
}
