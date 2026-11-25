// The corner buttons, bottom-right: the selection details (i) and the keyboard help (?), in one small island. Each
// opens its panel above the island and shows as pressed (the secondary variant) while the panel is open; opening one
// shuts the other, as they take the same place. The (i) opens the selection card (react/info-card.tsx), the "?" the
// keyboard help's popover (react/help.tsx).
import { Info } from "lucide-react";
import { useEffect, useRef } from "react";
import { infoFocus, infoOpen, toggleInfo } from "../ui/panels";
import { HelpButton } from "./help";
import { SHORTCUT } from "../ui/keyboard";
import { ICON } from "./icons";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";

export function CornerButtons() {
  const open = useSignal(infoOpen);
  const focus = useSignal(infoFocus);
  const details = useRef<HTMLButtonElement>(null);
  // Folding the card brings the focus back to this button (ui/panels.ts toggleInfo).
  useEffect(() => {
    if (focus !== "details") return;
    details.current?.focus({ preventScroll: true });
    infoFocus.value = null;
  }, [focus]);
  return (
    <div id="corner-buttons" className="island">
      <TipButton
        ref={details}
        variant={open ? "secondary" : "ghost"}
        size="icon"
        aria-label="Selection details"
        aria-controls="info"
        aria-expanded={open}
        tip="Selection details"
        shortcut={SHORTCUT.info}
        onClick={toggleInfo}
      >
        <Info {...ICON} />
      </TipButton>
      <HelpButton />
    </div>
  );
}
