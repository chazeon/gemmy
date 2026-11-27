// The dock's one toggle: a tab on the page's right edge that opens the dock and shuts it (style.css, #inspector-tab). Shut,
// it is a horizontal tab, [chevron][sliders], that peeks 4 px past the edge and slides out whole on hover or keyboard
// focus. Open, it is a slim chevron-only tab at the dock's left side. It is the islands' height, radius and shadow. It has no shortcut. A phone has no tab: its customize button opens the dock there
// (react/customize-button.tsx). Focus comes back to it when the dock shuts (ui/panels.ts toggleInspector).
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { inspector, inspectorFocus, toggleInspector } from "../ui/panels";
import { ICON_SMALL } from "./icons";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";

// The tab's look, as the islands': the island's height (--island, 44 px: a 36 px control in the island's 4 px padding), the
// island's radius on the left and square on the edge side, the island's shadow, and the bar's colours. The rest is the
// button's own. The classes are utilities, which win over the page's own stylesheet (style.css is its legacy layer).
const TAB =
  "h-(--island) min-w-0 rounded-l-(--radius-small) rounded-r-none border-0 bg-(--bar) text-(--muted) shadow-(--shadow) hover:bg-(--bar) hover:text-(--fg) transition-[translate,right] duration-(--slide-duration) ease-linear max-[640px]:hidden [body.no-scene_&]:hidden";
// Shut: 6 px padding and a 6 px gap. At rest the tab sits 4 px past the edge, for a device with hover only: on a touch
// screen it is whole. On hover or keyboard focus it slides out whole.
const SHUT =
  "gap-1.5 px-1.5 has-[>svg]:px-1.5 [@media(hover:hover)]:translate-x-[4px] hover:translate-x-0 focus-visible:translate-x-0";
// Open: the chevron alone in a slim 18 px tab (16 px icon, no padding), flush against the dock's left border, so it is whole.
const OPEN = "w-[18px] px-0 has-[>svg]:px-0 translate-x-0";

export function InspectorToggle() {
  const { open } = useSignal(inspector);
  const returnTo = useSignal(inspectorFocus);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (returnTo !== "opener") return;
    button.current?.focus({ preventScroll: true });
    inspectorFocus.value = null;
  }, [returnTo]);
  const Chevron = open ? ChevronRight : ChevronLeft;
  return (
    <TipButton
      ref={button}
      id="inspector-tab"
      variant="ghost"
      className={`${TAB} ${open ? OPEN : SHUT}`}
      aria-label="Customize"
      aria-controls="inspector"
      aria-expanded={open}
      aria-pressed={open}
      tip="Customize"
      side="left"
      onClick={toggleInspector}
    >
      <Chevron {...ICON_SMALL} />
      {open ? null : <SlidersHorizontal {...ICON_SMALL} />}
    </TipButton>
  );
}
