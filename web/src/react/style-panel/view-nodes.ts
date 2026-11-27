// The View section as plain data: the page's own settings for the scene, not a structure's, so the section shows on every
// tab. The Show toggles (atoms, the cell box, the axes) are checkboxes; the Outlines row is the outlines' toggle, with the outline
// width's number box beside it (the toggle and the width are separate commits). The values are read from the signals
// by the section (view-section.tsx), so a change made anywhere shows here.
import { outlines, showAtoms, showAxes, showBox } from "../../state";
import { DEFAULT_SCALE, OUTLINE_RANGE, chooseOutlineScale } from "../../ui/outline-scale";
import type { PaneNode } from "./pane-model";

export interface ViewValues {
  atoms: boolean;
  outlines: boolean;
  box: boolean;
  axes: boolean;
  scale: number;
}

export function viewNodes(values: ViewValues): PaneNode[] {
  return [
    { kind: "checkbox", label: "Atoms", value: values.atoms, commit: (on) => (showAtoms.value = on) },
    {
      kind: "number",
      label: "Outlines",
      value: values.scale,
      ...OUTLINE_RANGE,
      default: DEFAULT_SCALE,
      toggle: { value: values.outlines, commit: (on) => (outlines.value = on) },
      commit: chooseOutlineScale,
    },
    { kind: "checkbox", label: "Cell box", value: values.box, commit: (on) => (showBox.value = on) },
    { kind: "checkbox", label: "Axes", value: values.axes, commit: (on) => (showAxes.value = on) },
  ];
}
