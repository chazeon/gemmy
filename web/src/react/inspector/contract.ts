// The inspector dock's shared shapes: the dock (react/inspector/inspector.tsx) stacks sections, and each section is drawn
// by its own module with the DockSection frame (react/inspector/dock-section.tsx). Everything a section needs from the
// dock is here, so the dock and the sections can be written apart.
import type { ReactNode } from "react";

// The dock's sections, top to bottom: the View (on every tab), then the style sections of a structure tab. The picked
// object's details are the details card's (react/selection-card.tsx), not the dock's.
export const SECTION_IDS = ["view", "atoms", "bonds", "shapes", "cell"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

// The dock's small icon button (a 20 px box, a 14 px icon), for the frame's add, close and copy buttons. The sizes are the
// dock's own tokens (style.css, #inspector), so it takes no shadcn size.
// A plain note in the dock (the no-structure note, an empty section's note): one style, so
// every note starts on the Tweakpane folder title's x (8 px in from the dock's inner edge), reads the same, and sits on one row.
export const DOCK_NOTE = "flex min-h-5 items-center pr-1 pl-2 text-[11px] leading-[15px] text-(--dock-muted)";

export const DOCK_ICON_BUTTON =
  "size-(--dock-control) rounded-(--dock-radius) text-(--dock-muted) hover:text-foreground";

// What a section hands to its frame: a header (title, an optional count badge and an optional add button) over a body
// that folds. The frame keeps the open state (remembered per section) and scrolls a section into view when the dock is
// opened at it.
export interface DockSectionProps {
  id: SectionId;
  title: string;
  count?: number;
  // The header's "+" button, with the accessible name of what it adds ("Add a bond").
  // onAdd gets whether the section was shut: a press on the + of a shut section opens it, and shows the add row at once.
  add?: { label: string; onAdd(sectionShut: boolean): void };
  children: ReactNode;
}
