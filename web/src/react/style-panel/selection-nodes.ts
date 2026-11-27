// The Selection pane: the readout as one folder titled by its heading (readoutTitle), with its rows and the View buttons.
import { type BondEnd, type Readout, readoutTitle } from "../../ui/readout";
import type { PaneNode } from "./pane-model";

export interface SelectionActions {
  centre(): void;
  along(axis: ViewAxis): void;
  copy(text: string): void;
}

type ViewAxis = "a" | "b" | "c";
type Picked<K extends Readout["kind"]> = Extract<Readout, { kind: K }>;

export function selectionNodes(data: Readout, actions: SelectionActions): PaneNode[] {
  switch (data.kind) {
    case "none":
      return [];
    case "bond":
      return [readoutFolder(data, [...bondRows(data), ...viewButtons(actions)])];
    case "polyhedron":
      return [readoutFolder(data, [...polyhedronRows(data), ...viewButtons(actions)])];
    case "atom":
      return [readoutFolder(data, [...atomRows(data, actions), ...viewButtons(actions)])];
  }
}

// The folder of a readout: its heading is the title, and it is open when a pick shows it.
function readoutFolder(data: Picked<"bond" | "polyhedron" | "atom">, children: PaneNode[]): PaneNode {
  return { kind: "folder", title: readoutTitle(data), expanded: true, children };
}

function bondRows(data: Picked<"bond">): PaneNode[] {
  return [
    { kind: "readonly", label: "Length", value: `${data.length} Å` },
    { kind: "readonly", label: "End A", value: endText(data.ends[0]) },
    { kind: "readonly", label: "End B", value: endText(data.ends[1]) },
  ];
}

function polyhedronRows(data: Picked<"polyhedron">): PaneNode[] {
  return [
    { kind: "readonly", label: "Centre", value: data.centre },
    { kind: "readonly", label: "Bonds", value: `${data.bonds} Å` },
    { kind: "readonly", label: "Mean", value: `${data.mean} Å` },
    { kind: "readonly", label: "Δ", value: `${data.delta} × 10⁻⁴` },
  ];
}

// An atom's rows: its reference (with Copy ref, when it has one), its fractional and Cartesian positions, and the
// distance to the polyhedron it is a corner of.
function atomRows(data: Picked<"atom">, actions: SelectionActions): PaneNode[] {
  const rows: PaneNode[] = [];
  const ref = data.ref;
  if (ref !== null) {
    rows.push({ kind: "readonly", label: "Ref", value: ref });
    rows.push({ kind: "button", title: "Copy ref", commit: () => actions.copy(ref) });
  }
  if (data.fractional !== null) rows.push({ kind: "readonly", label: "Fractional", value: data.fractional });
  rows.push({ kind: "readonly", label: "Cartesian", value: `${data.cartesian} Å` });
  if (data.host !== null && data.neighbours !== null) {
    rows.push({ kind: "readonly", label: `${data.host} nbrs`, value: `${data.neighbours} Å` });
  }
  return rows;
}

// The View buttons: Centre frames the object; a, b and c look along that cell axis.
function viewButtons(actions: SelectionActions): PaneNode[] {
  const along = (["a", "b", "c"] as const).map(
    (axis: ViewAxis): PaneNode => ({ kind: "button", title: axis, commit: () => actions.along(axis) }),
  );
  return [{ kind: "button", title: "Centre", commit: () => actions.centre() }, ...along];
}

// One end of a bond: its label, then its reference.
function endText(end: BondEnd): string {
  return end.ref === null ? end.label : `${end.label} ${end.ref}`;
}
