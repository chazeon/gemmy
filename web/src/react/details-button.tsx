// The details button, bottom-right in the corner island: the Info icon, which opens and shuts the details card
// (react/selection-card.tsx). It shows as pressed while the card is open. Its shortcut is the i key (ui/keyboard.ts), which
// opens and shuts the card the same way. Focus comes back to it when the card shuts (ui/panels.ts chooseDetails).
import { Info } from "lucide-react";
import { useEffect, useRef } from "react";
import { SHORTCUT } from "../ui/keyboard";
import { detailsFocus, detailsOpen, toggleDetails } from "../ui/panels";
import { ICON } from "./icons";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";

export function DetailsButton() {
  const open = useSignal(detailsOpen);
  const focus = useSignal(detailsFocus);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus !== "button") return;
    button.current?.focus({ preventScroll: true });
    detailsFocus.value = null;
  }, [focus]);
  return (
    <TipButton
      ref={button}
      id="details-button"
      variant={open ? "secondary" : "ghost"}
      size="icon"
      aria-label="Details"
      aria-controls="info"
      aria-expanded={open}
      tip="Details"
      shortcut={SHORTCUT.info}
      onClick={toggleDetails}
    >
      <Info {...ICON} />
    </TipButton>
  );
}
