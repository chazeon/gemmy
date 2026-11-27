// Part of the config edits: the shared machinery is in config-edit-draft.ts, read it first.
//
// Polyhedra, by rule index, and the automatic polyhedra. The bonds and centres a polyhedron covers are here too, since they
// are keyed by the polyhedron's centre.
import type { Color, PolyhedronRule, SceneConfig } from "./config";
import { type Draft, type Row, addRule, editDraft, editRule, removeRule } from "./config-edit-draft";
import { elementBase } from "./config-edit-elements";
import {
  automaticRowsOf,
  keysOwnedAfter,
  placedRows,
  replaceOwnedRows,
  rowsByKey,
  withoutRows,
} from "./config-edit-ownership";

export function setPolyhedronVisible(config: SceneConfig, index: number, visible: boolean): SceneConfig {
  return editRule(config, "polyhedra", index, { visible });
}

export function setPolyhedronColor(config: SceneConfig, index: number, color: Color): SceneConfig {
  return editRule(config, "polyhedra", index, { color: [...color] });
}

export function setPolyhedronCenter(config: SceneConfig, index: number, center: string): SceneConfig {
  return editRule(config, "polyhedra", index, { center });
}

export function setPolyhedronWindow(config: SceneConfig, index: number, min: number, max: number): SceneConfig {
  return editRule(config, "polyhedra", index, { min, max });
}

// Whether the polyhedron also builds around the boundary copies of its centre (the cell faces then have no stray ligand).
export function setPolyhedronImageCentres(config: SceneConfig, index: number, imageCentres: boolean): SceneConfig {
  return editRule(config, "polyhedra", index, { image_centers: imageCentres });
}

// The ligand names: the schema sorts them, drops repeats, and refuses an empty set.
export function setPolyhedronLigands(config: SceneConfig, index: number, ligands: string[]): SceneConfig {
  return editRule(config, "polyhedra", index, { ligands: [...ligands] });
}

// A new polyhedron builds around the boundary copies of its centre too (image_centers), so a centre on a cell face keeps its
// whole polyhedron.
export function addPolyhedronRule(
  config: SceneConfig,
  center: string,
  ligands: string[],
  min: number,
  max: number,
): SceneConfig {
  return addRule(config, "polyhedra", newPolyhedronRow(center, ligands, min, max));
}

// Adds a polyhedron and hides the bond rules that join its centre to one of its ligands: the polyhedron draws those bonds
// as its edges. The bond rules stay, hidden, so Show brings them back.
export function addPolyhedronReplacingBonds(
  config: SceneConfig,
  center: string,
  ligands: string[],
  min: number,
  max: number,
): SceneConfig {
  return editDraft(config, (draft) => {
    const polyhedron = newPolyhedronRow(center, ligands, min, max);
    return {
      ...draft,
      bonds: hideBondsCoveredBy(draft.bonds, [polyhedron]),
      polyhedra: [...draft.polyhedra, polyhedron],
    };
  });
}

// The config with the bonds its polyhedra cover hidden. The defaults of a structure use it (compiler/entry.ts). `emitted`
// are the centres whose polyhedra the compile draws: a centre whose ligands are collinear draws none, so its bonds stay.
export function hideBondsCoveredByPolyhedra(config: SceneConfig, emitted: readonly string[]): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    bonds: hideBondsCoveredBy(draft.bonds, drawnBy(draft.polyhedra, emitted)),
  }));
}

// The config with the centre atoms of its emitted polyhedra hidden (see hideBondsCoveredByPolyhedra for `emitted`).
export function hideCentresOfPolyhedra(config: SceneConfig, emitted: readonly string[]): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    elements: hideCentres(draft, drawnBy(draft.polyhedra, emitted)),
  }));
}

export function removePolyhedronRule(config: SceneConfig, index: number): SceneConfig {
  return removeRule(config, "polyhedra", index);
}

// The polyhedron rows whose centre is one the compile draws a polyhedron for.
function drawnBy(polyhedra: Row[], emitted: readonly string[]): Row[] {
  return polyhedra.filter((polyhedron) => emitted.includes(centreOf(polyhedron)));
}

// ---- Automatic polyhedra: the rules detection owns, one per centre label ----------------------------------------------
// Detection makes one polyhedron per centre element, so the page keeps the centres it owns (ui/structure-model.ts), as the
// bonds keep their pairs. A centre whose rule the user edits leaves the set, and the user's rule is then left alone.

// The centre element of a polyhedron row (a config rule or a file row).
function centreOf(rule: Row | PolyhedronRule): string {
  return String(rule.center);
}

// The centres detection would place that no user polyhedron already holds.
export function detectedPolyhedraOwnership(
  config: SceneConfig,
  owned: readonly string[],
  detected: PolyhedronRule[],
): string[] {
  return keysOwnedAfter(config.polyhedra, centreOf, owned, detected.map(centreOf));
}

// Re-detection of the automatic polyhedra (see replaceOwnedRows): an owned centre's polyhedron is replaced in place. The bonds
// the old polyhedra covered come back where no visible polyhedron still covers them, then the bonds and centre atoms of each
// placed polyhedron that a compile draws are hidden, as addPolyhedronReplacingBonds hides them. `emitted` are those centres
// (detectShapes): a centre whose ligands are collinear has a rule that draws nothing, so its atoms and bonds stay shown.
export function replaceAutomaticPolyhedra(
  config: SceneConfig,
  owned: readonly string[],
  detected: PolyhedronRule[],
  emitted: readonly string[],
): SceneConfig {
  const rows = rowsByKey(detected, centreOf, polyhedronFileRow);
  return editDraft(config, (draft) => {
    const released = automaticRowsOf(draft.polyhedra, centreOf, owned);
    const polyhedra = replaceOwnedRows(draft.polyhedra, centreOf, owned, rows);
    const shown = showBondsUncoveredAfter(draft.bonds, released, polyhedra);
    const placed = drawnBy(placedRows(draft.polyhedra, centreOf, owned, rows), emitted);
    const elements = showCentresUncoveredAfter(draft, released, polyhedra);
    return {
      ...draft,
      polyhedra,
      bonds: hideBondsCoveredBy(shown, placed),
      elements: hideCentres({ ...draft, elements }, placed),
    };
  });
}

// Clear automatic: removes the automatic polyhedron of each owned centre; the user's polyhedra stay. The bonds the removed
// polyhedra covered are shown again, unless a visible polyhedron still covers them.
export function clearAutomaticPolyhedra(config: SceneConfig, owned: readonly string[]): SceneConfig {
  return editDraft(config, (draft) => {
    const released = automaticRowsOf(draft.polyhedra, centreOf, owned);
    const polyhedra = withoutRows(draft.polyhedra, released);
    return {
      ...draft,
      polyhedra,
      bonds: showBondsUncoveredAfter(draft.bonds, released, polyhedra),
      elements: showCentresUncoveredAfter(draft, released, polyhedra),
    };
  });
}

// ---- The centre atoms a polyhedron hides ------------------------------------------------------------------------------
// An automatic polyhedron stands for its centre's atoms, so its centre element is hidden (the element's visibility, as
// "Show centre atom" sets it). Detection hides it (the defaults and Re-detect). Clearing, or re-detecting, shows it back
// only where no visible polyhedron still has that centre. Hiding a polyhedron with its eye does not show its centre.

// The element entries with the centre of each polyhedron in `polyhedra` hidden.
function hideCentres(draft: Draft, polyhedra: Row[]): Record<string, Row> {
  const elements = { ...draft.elements };
  for (const polyhedron of polyhedra) {
    const key = centreOf(polyhedron);
    elements[key] = { ...elementBase({ ...draft, elements }, key), visible: false };
  }
  return elements;
}

// The element entries with the centres of the released polyhedra shown again, unless a visible polyhedron in `remaining`
// still has the centre.
function showCentresUncoveredAfter(draft: Draft, released: Row[], remaining: Row[]): Record<string, Row> {
  const visibleCentres = new Set(remaining.filter((polyhedron) => polyhedron.visible !== false).map(centreOf));
  const elements = { ...draft.elements };
  for (const polyhedron of released) {
    const key = centreOf(polyhedron);
    if (!visibleCentres.has(key) && Object.hasOwn(elements, key) && elements[key].visible === false) {
      elements[key] = { ...elements[key], visible: true };
    }
  }
  return elements;
}

// ---- The bonds a polyhedron draws -------------------------------------------------------------------------------------
// A polyhedron draws the bonds that join its centre to a ligand as its edges, so those bonds are hidden while it is drawn.
// Hiding happens when a polyhedron rule is added or detected. Showing back happens only when automatic polyhedra are
// cleared (or re-detected), and only for bonds no visible polyhedron still covers. Hiding a polyhedron with its eye does
// not show its bonds, and a bond no polyhedron covers is never touched here, so a bond the user hid stays hidden.

// Whether a polyhedron covers a bond: the bond joins its centre to one of its ligands.
function coversBond(polyhedron: Row, bond: Row): boolean {
  return joinsCentre(bond, centreOf(polyhedron), polyhedron.ligands as string[]);
}

// The bonds with those that one of `polyhedra` covers hidden.
function hideBondsCoveredBy(bonds: Row[], polyhedra: Row[]): Row[] {
  return bonds.map((bond) =>
    polyhedra.some((polyhedron) => coversBond(polyhedron, bond)) ? { ...bond, visible: false } : bond,
  );
}

// The bonds that the released polyhedra covered become visible, unless a visible polyhedron in `remaining` still covers them.
function showBondsUncoveredAfter(bonds: Row[], released: Row[], remaining: Row[]): Row[] {
  const visibleNow = remaining.filter((polyhedron) => polyhedron.visible !== false);
  return bonds.map((bond) => {
    const wasCovered = released.some((polyhedron) => coversBond(polyhedron, bond));
    const stillCovered = visibleNow.some((polyhedron) => coversBond(polyhedron, bond));
    return wasCovered && !stillCovered ? { ...bond, visible: true } : bond;
  });
}

// Whether a bond rule joins the centre to one of the ligands, in either order.
function joinsCentre(row: Row, centre: string, ligands: string[]): boolean {
  return ligands.some((ligand) => (row.a === centre && row.b === ligand) || (row.b === centre && row.a === ligand));
}

// A detected polyhedron as the config file writes it (its centre, ligands, window and colour; the schema fills the rest).
function polyhedronFileRow(rule: PolyhedronRule): Row {
  return {
    center: rule.center,
    ligands: [...rule.ligands],
    min: rule.min_distance,
    max: rule.max_distance,
    color: [...rule.color],
    image_centers: true,
  };
}

// A polyhedron rule as the Add row writes it: the schema fills the rest, and image_centers is on.
function newPolyhedronRow(center: string, ligands: string[], min: number, max: number): Row {
  return { center, ligands: [...ligands], min, max, image_centers: true };
}
