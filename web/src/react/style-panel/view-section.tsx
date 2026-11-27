// The dock's View section: the scene's Show toggles and the outline width (view-nodes.ts), drawn in the dock's frame. It is the
// dock's first section, on every tab: these settings apply to any scene, a structure's or a plain one's.
import { outlines, showAtoms, showBox } from "../../state";
import { outlineScale } from "../../ui/outline-scale";
import { DockSection } from "../inspector/dock-section";
import { useSignal } from "../use-signal";
import { StylePane } from "./pane";
import { viewNodes } from "./view-nodes";

export function ViewSection() {
  // The section reads the signals, so the pane shows a change made anywhere, the keyboard included.
  const atoms = useSignal(showAtoms);
  const shownOutlines = useSignal(outlines);
  const box = useSignal(showBox);
  const scale = useSignal(outlineScale);
  return (
    <DockSection id="view" title="View">
      <StylePane nodes={viewNodes({ atoms, outlines: shownOutlines, box, scale })} />
    </DockSection>
  );
}
