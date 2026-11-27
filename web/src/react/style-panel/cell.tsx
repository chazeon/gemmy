// The Cell section: three folders by property (the supercell count, the periodic switch, the display box), built as pane
// nodes (pane-model.ts, cellNodes) and drawn by Tweakpane in the dock's frame (react/inspector/dock-section.tsx).
import { DockSection } from "../inspector/dock-section";
import { cellNodes } from "./cell-nodes";
import type { SectionProps } from "./props";
import { StylePane, useEdits } from "./pane";

export function CellSection(props: SectionProps) {
  const apply = useEdits(props);
  return (
    <DockSection id="cell" title="Cell">
      <StylePane nodes={cellNodes(props.config, apply)} />
    </DockSection>
  );
}
