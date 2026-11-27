// The customize button, in the bottom-right island on a phone: the SlidersHorizontal icon, which opens and shuts the inspector
// dock as a bottom sheet of its style sections (react/inspector/inspector.tsx). It is the dock's opener there, as the edge tab
// is on a wide screen (style.css hides it on a wide screen, where the tab does this job). It shows as pressed while the dock
// is open. Focus comes back to it when the dock shuts (ui/panels.ts toggleInspector).
import { SlidersHorizontal } from "lucide-react";
import { inspector, toggleInspector } from "../ui/panels";
import { ICON } from "./icons";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";

export function CustomizeButton() {
  const { open } = useSignal(inspector);
  return (
    <TipButton
      id="customize-button"
      variant={open ? "secondary" : "ghost"}
      size="icon"
      aria-label="Customize"
      aria-controls="inspector"
      aria-expanded={open}
      tip="Customize"
      // On a wide screen the edge tab does this job, so the button is hidden there (a utility: see inspector-toggle.tsx).
      className="min-[641px]:hidden"
      onClick={toggleInspector}
    >
      <SlidersHorizontal {...ICON} />
    </TipButton>
  );
}
