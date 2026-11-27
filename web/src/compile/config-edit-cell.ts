// Part of the config edits: the shared machinery is in config-edit-draft.ts, read it first.
//
// Cell: the supercell, the display box and the periodic flags. The axes x, y and z of the cell are the config's fractional
// axes: x runs along a, y along b and z along c, of the supercell. In a box and in the periodic flags they are given in
// that tuple order.
import type { Axis, Range, SceneConfig } from "./config";
import { type Row, editDraft } from "./config-edit-draft";
import type { Vec3 } from "../types";

// Where each axis sits in the periodic flags, and in a corner of the box.
const AXIS_POSITION: Readonly<Record<Axis, number>> = { x: 0, y: 1, z: 2 };

export function setSupercell(config: SceneConfig, supercell: [number, number, number]): SceneConfig {
  return editDraft(config, (draft) => ({ ...draft, cells: { ...draft.cells, supercell: [...supercell] } }));
}

// The display box of one axis (x along a, y along b, z along c), as fractions of the supercell; null gives the axis back
// the whole cell.
export function setBox(config: SceneConfig, axis: Axis, range: Range | null): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    cells: { ...draft.cells, box: boxWithAxis(draft.cells.box, axis, range) },
  }));
}

// The whole display box in one edit: `from` and `to` are its low and high corners, as fractions of the supercell (x, y, z in
// that order). An axis that spans the whole cell (0 to 1) is left out, as setBox(null) leaves it out.
export function setBoxEnds(config: SceneConfig, ends: { from: Vec3; to: Vec3 }): SceneConfig {
  return editDraft(config, (draft) => ({ ...draft, cells: { ...draft.cells, box: boxOf(ends) } }));
}

// The periodic flag of one axis (x along a, y along b, z along c); the flags are stored as [x, y, z].
export function setPeriodic(config: SceneConfig, axis: Axis, periodic: boolean): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    cells: {
      ...draft.cells,
      periodic: draft.cells.periodic.map((flag, position) => (position === AXIS_POSITION[axis] ? periodic : flag)),
    },
  }));
}

// The box with one axis set to `range`, or with the axis removed (the whole cell) when range is null.
function boxWithAxis(box: Row, axis: Axis, range: Range | null): Row {
  const others = Object.fromEntries(Object.entries(box).filter(([name]) => name !== axis));
  return range === null ? others : { ...others, [axis]: [...range] };
}

// The box of two corners: each axis with its low and high, except the axes that span the whole cell.
function boxOf(ends: { from: Vec3; to: Vec3 }): Row {
  const box: Row = {};
  for (const axis of ["x", "y", "z"] as const) {
    const position = AXIS_POSITION[axis];
    const low = ends.from[position];
    const high = ends.to[position];
    if (low !== 0 || high !== 1) box[axis] = [low, high];
  }
  return box;
}
