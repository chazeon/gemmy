// The View section as plain data: the page's own settings for the scene, not a structure's, so the section shows on every
// tab. The four Show toggles (atoms, outlines, the cell box, the axes) are checkboxes; the outline width is a list. The values are read
// from the signals by the section (view-section.tsx), so a change made anywhere shows here.
import { outlines, showAtoms, showAxes, showBox } from "../../state";
import { OUTLINE_WIDTHS, chooseOutlineScale } from "../../ui/outline-scale";
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
    { kind: "checkbox", label: "Outlines", value: values.outlines, commit: (on) => (outlines.value = on) },
    { kind: "checkbox", label: "Cell box", value: values.box, commit: (on) => (showBox.value = on) },
    { kind: "checkbox", label: "Axes", value: values.axes, commit: (on) => (showAxes.value = on) },
    {
      kind: "list",
      label: "Outline width",
      value: String(values.scale),
      options: OUTLINE_WIDTHS.map((width) => ({ text: width.label, value: String(width.value) })),
      commit: (next) => {
        const width = OUTLINE_WIDTHS.find((choice) => String(choice.value) === next);
        if (width) chooseOutlineScale(width.value);
      },
    },
  ];
}
